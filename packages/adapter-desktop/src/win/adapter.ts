import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AdapterError, encodeFrame } from '@git-qa/core';
import type {
  Action,
  AdapterCapabilities,
  LiveView,
  Observation,
  RecordingControl,
  Screenshot,
  TargetAdapter,
  TargetSession,
} from '@git-qa/core';

import { fingerprintOf } from '../fingerprint.js';
import { findInOcr, parseOcr } from '../ocr.js';
import type { OcrLine } from '../ocr.js';
import { parseWinWindows, winArgs } from './tool.js';
import type { WinWindow } from './tool.js';
import type { DesktopAdapterOptions } from '../adapter.js';

/**
 * **Windows のデスクトップアプリを見る**（2026-09-12・人の指示）。
 *
 * > 顧客対象が大抵 win なので、win で検証する必要があります。
 *
 * macOS 版とは**別のソース**にしてある（2026-09-07 の人の指定）。
 * 窓の探し方も、文字の読み方も、押し方も、OS ごとに考え方が違う。
 * 1 本にまとめると、**どちらの都合でもない分岐**が増える。
 *
 * 上（実行器・画面）から見た口は**同じ `TargetSession`** なので、そちらは 1 行も変わらない。
 *
 * ## macOS 版との違い
 *
 * | | macOS | Windows |
 * |---|---|---|
 * | 文字 | AX（段 1）＋ Vision OCR（段 2） | **UI Automation だけ**（段 2 はまだ無い） |
 * | 押す | `AXPress` | UI Automation の `Invoke` |
 * | 録る | ScreenCaptureKit | **まだ無い**（`unsupported`） |
 *
 * **録画はまだ無い。**画面（`screen.webp`）は残るので、証跡としては成立する。
 * **要ると分かってから足す。**
 */

const KIND = 'desktop' as const;

/** 映像の間隔。macOS 側と揃える（1 秒に 8 枚）。 */
const FRAME_INTERVAL_MS = 125;

const capabilities: AdapterCapabilities = {
  // Windows の UI Automation。macOS の AX と同じ位置づけ（C24）。
  observation: 'ui-automation',
  // **録画はまだ持たない。**「できない」を黙って `failed` にしない（C20）。
  recording: false,
  // まだ文字を送れない。**確かめていないものを「できる」と言わない。**
  textInput: 'none',
  // 窓の持ち主の名前そのもの。**パッケージ名は無い。**
  appId: 'name',
};

/** 外の道具を 1 つ呼ぶ。**出た文字をそのまま返す**（言い換えると原因が絞れなくなる）。 */
function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args]);
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (err += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `${command} が ${String(code)} で終わった`));
    });
  });
}

export interface WindowsDesktopAdapterOptions extends DesktopAdapterOptions {
  /** `git-qa-win` の場所。**無ければ何もできない**（macOS の OCR と違い、これが本体）。 */
  readonly toolPath: string;
}

export function createWindowsDesktopAdapter(options: WindowsDesktopAdapterOptions): TargetAdapter {
  const now = options.now ?? (() => new Date());
  const tool = (args: readonly string[]): Promise<string> => run(options.toolPath, args);

  return {
    kind: KIND,
    capabilities,

    async connect(): Promise<TargetSession> {
      const found = await look(tool, options.app);
      return createSession({ ...options, now, tool, window: found });
    },
  };
}

/** 窓を 1 つ見つける。**見つからないことと、何も映っていないことは別。** */
async function look(
  tool: (args: readonly string[]) => Promise<string>,
  app: string,
): Promise<WinWindow> {
  const found = parseWinWindows(await tool(winArgs.windows(app)));
  const first = found[0];
  if (first === undefined) {
    throw new AdapterError(
      KIND,
      `「${app}」の窓が見つからない。起動しているか、名前が合っているかを見てください` +
        '（実行ファイルの名前か、窓の題の一部で探しています）',
    );
  }
  return first;
}

interface SessionDeps extends WindowsDesktopAdapterOptions {
  readonly now: () => Date;
  readonly tool: (args: readonly string[]) => Promise<string>;
  readonly window: WinWindow;
}

function createSession(deps: SessionDeps): TargetSession {
  const { app, build, now, tool } = deps;
  let window = deps.window;
  let closed = false;
  let liveOpen = false;

  const ensureOpen = (): void => {
    if (closed) throw new AdapterError(KIND, 'アプリとの接続はもう閉じている');
  };

  /** 窓は動く。**撮る前に取り直す**（動かしたまま古い場所を撮らない）。 */
  const refresh = async (): Promise<WinWindow> => {
    window = await look(tool, app);
    return window;
  };

  const shoot = async (): Promise<{ bytes: Uint8Array; window: WinWindow }> => {
    const target = await refresh();
    const dir = await mkdtemp(join(tmpdir(), 'git-qa-win-'));
    const path = join(dir, 'frame.png');
    try {
      await tool(winArgs.shot(target.hwnd, path));
      return { bytes: new Uint8Array(await readFile(path)), window: target };
    } finally {
      // 撮った絵は残さない。**人の temp に溜まり続けるのは、頼まれていない。**
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  /** 読める文字と、その位置。**macOS の段 2（OCR）と同じ形**なので読む側を分けない。 */
  const readText = async (): Promise<OcrLine[]> =>
    parseOcr(await tool(winArgs.text(window.hwnd)).catch(() => ''));

  const liveView: LiveView = {
    get isOpen() {
      return liveOpen;
    },
    transport: { kind: 'image-frames', label: `git-qa-win ${app}`, mimeType: 'image/jpeg' },
    open() {
      ensureOpen();
      liveOpen = true;
      return Promise.resolve();
    },
    close() {
      liveOpen = false;
      return Promise.resolve();
    },
    frames(): AsyncIterable<Uint8Array> {
      if (!liveOpen) {
        throw new AdapterError(KIND, '映像を出す準備ができていない（ライブビューを開く前）');
      }
      return {
        async *[Symbol.asyncIterator]() {
          while (liveOpen && !closed) {
            const started = Date.now();
            // 撮れない 1 枚で映像を終わらせない（窓が一瞬隠れた等）。
            const shot = await shoot().catch(() => undefined);
            if (shot !== undefined) yield encodeFrame(shot.bytes);

            const rest = FRAME_INTERVAL_MS - (Date.now() - started);
            if (rest > 0) await new Promise((resolve) => setTimeout(resolve, rest));
          }
        },
      };
    },
  };

  const recording: RecordingControl = {
    requested: false,
    start: () => Promise.resolve(),
    stop: () =>
      Promise.resolve({
        state: 'unsupported' as const,
        reason: 'Windows の録画はまだ持っていない（画面は 1 件ごとに残ります）',
      }),
  };

  return {
    target: { kind: KIND, device: app, build },
    liveView,
    recording,
    get isClosed() {
      return closed;
    },
    screenSize: () => Promise.resolve({ width: window.width, height: window.height }),

    async act(action: Action): Promise<void> {
      ensureOpen();
      await dispatch(action, {
        tool,
        window: () => window,
        read: readText,
        onPointed: deps.onPointed,
      });
    },

    async observe(): Promise<Observation> {
      ensureOpen();
      const lines = await readText();
      return {
        kind: KIND,
        capturedAt: now().toISOString(),
        raw: {
          // macOS 側は段 1（AX）と段 2（OCR）を分けて持つ。Windows は 1 段だけ。
          elements: [],
          ocr: lines,
          text: [...new Set(lines.map((l) => l.text))].join('\n'),
        },
      };
    },

    async screenshot(): Promise<Screenshot> {
      ensureOpen();
      const shot = await shoot();
      return { format: 'png', bytes: shot.bytes, capturedAt: now().toISOString() };
    },

    /** **相手が走行中に入れ替わっていないか**（外部レビュー meta-taro/git-qa#3）。 */
    async fingerprint(): Promise<string | undefined> {
      const path = (await tool(winArgs.exe(window.pid)).catch(() => '')).trim();
      if (path === '') return undefined;
      const info = await stat(path).catch(() => undefined);
      return info === undefined ? undefined : fingerprintOf(path, info.size, info.mtime);
    },

    close(): Promise<void> {
      closed = true;
      liveOpen = false;
      // **アプリは閉じない。**人が開いていたものを、こちらの都合で落とさない。
      return Promise.resolve();
    },
  };
}

interface DispatchDeps {
  readonly tool: (args: readonly string[]) => Promise<string>;
  readonly window: () => WinWindow;
  readonly read: () => Promise<OcrLine[]>;
  readonly onPointed?: DesktopAdapterOptions['onPointed'];
}

/**
 * 操作を 1 つ送る。
 *
 * **いまは押すだけ。**なぞる・文字を打つ・回すは、押すが実物で効いてから足す ——
 * **確かめていないものを「できる」と言わない。**
 */
async function dispatch(action: Action, deps: DispatchDeps): Promise<void> {
  if (action.kind !== 'tap') {
    throw new AdapterError(KIND, `Windows ではまだ「${action.kind}」を送れない`);
  }

  const window = deps.window();
  const at = action.target;
  const point =
    at.at === 'point' ? { x: window.x + at.x, y: window.y + at.y } : await byText(at.ref, deps);

  // **AI がどこを触ったかを知らせる**（要望シート No.1）。座標は窓の中のもの。
  deps.onPointed?.({
    x: point.x - window.x,
    y: point.y - window.y,
    ...(at.at === 'element' ? { label: at.ref } : {}),
  });

  await deps.tool(winArgs.press(window.hwnd, point.x, point.y));
}

/** 文字で指された所を探す。**見つからないものを、当てずっぽうで押さない。** */
async function byText(text: string, deps: DispatchDeps): Promise<{ x: number; y: number }> {
  const found = findInOcr(await deps.read(), text);
  if (found === undefined) {
    throw new AdapterError(KIND, `画面に「${text}」が見つからない`);
  }
  // UI Automation は画面の座標で返す。窓の中へ直さずそのまま使う（押すのも画面の座標）。
  return found;
}

export { KIND as WINDOWS_DESKTOP_KIND };
