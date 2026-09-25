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
  PointerRef,
  RecordingControl,
  Screenshot,
  TargetAdapter,
  TargetSession,
} from '@git-qa/core';

import { fingerprintOf } from '../fingerprint.js';
import { findInOcr, parseOcr } from '../ocr.js';
import type { OcrLine } from '../ocr.js';
import { parseWinWindows, pickWindow, whyUnusable, winArgs } from './tool.js';
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
  // **日本語もそのまま入る**（2026-09-14・実測）。`SetValue` は IME を通らない。
  textInput: 'any',
  // **前面に一瞬出るが、届く**（2026-09-14・実測。#10）。
  keyInput: true,
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
  // **見つかった順の 1 つ目を使わない**（2026-09-12・Windows 機で実測）。
  // 題にパスが入っている explorer や、16x16 の隠れ窓が先に出る。
  const first = pickWindow(found, app);
  if (first === undefined) {
    throw new AdapterError(
      KIND,
      `「${app}」の窓が見つからない。起動しているか、名前が合っているかを見てください` +
        '（実行ファイルの名前か、窓の題の一部で探しています）',
    );
  }

  // **選べたことと、検証に使えることは別**（2026-09-12・実測）。
  // 16x16 の道具窓を掴んだまま進むと、**その絵が証跡に残る。**
  const why = whyUnusable(first);
  if (why !== undefined) {
    throw new AdapterError(KIND, `「${app}」の${why}`);
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
    /**
     * **映像の実寸。**取り直してから答える（2026-09-25・人が実物で見つけた）。
     *
     * **窓は走っている間に大きさが変わる。**覚えた値を返すと、映像は新しい大きさで
     * 流れているのに、赤い枠と矢印だけが古い大きさで置かれる。
     */
    async screenSize(): Promise<{ width: number; height: number }> {
      const target = await refresh();
      return { width: target.width, height: target.height };
    },

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
 * 押す・入れる・回す・キー。**確かめていないものを「できる」と言わない**
 * （入れない操作は、下で「送れない」と言って止まる）。
 */
async function dispatch(action: Action, deps: DispatchDeps): Promise<void> {
  if (action.kind === 'tap') {
    const { window, point } = await aim(action.target, deps);
    await deps.tool(winArgs.press(window.hwnd, point.x, point.y));
    return;
  }

  /**
   * 文字を入れる。**欄を指すかどうかで、入れ方が違う。**
   *
   * **欄を指す（#9）—— `SetValue` で欄の中身を置き換える。**1 文字ずつ打つのではないので、
   * **焦点も要らず、相手も前面に出ない。**IME を通らないので日本語もそのまま入る
   * （2026-09-14・実測。検索欄に日本語を入れたら候補が反応した ＝
   * 値を置いただけでなく、アプリ側にイベントが届いている）。
   *
   * **欄を指さない（#42）—— 焦点のある欄へ 1 文字ずつ打つ**（macOS の `keystroke` と同じ意味）。
   * 日付欄の年を 4 桁で止める、のような**1 キーごとに走る制限**は、`SetValue` では通らない ——
   * **確かめたいものを迂回してしまう。**だから打つ。**前面に一瞬出る**（`key` と同じ仕組み）。
   *
   * 以前はここを断っていた（「焦点のある所へ黙って入れると、人が見ていない欄が書き変わる」）。
   * **欄を指さずに書いたのはシートの書き手で、焦点を置く手順はその前の行に在る。**
   * macOS では最初からこの意味で通しており、**Windows だけが止まっていた。**
   */
  if (action.kind === 'type') {
    if (action.target === undefined) {
      await deps.tool(winArgs.keys(deps.window().hwnd, action.text));
      return;
    }
    const { window, point } = await aim(action.target, deps);
    await deps.tool(winArgs.type(window.hwnd, point.x, point.y, action.text));
    return;
  }

  /**
   * 回す（meta-taro/git-qa#9）。**デスクトップでは、なぞる＝スクロール**
   * （指でなぞる相手ではない）。1 段への換算は macOS 側と揃えてある。
   */
  if (action.kind === 'swipe') {
    const from = await aim(action.from, deps);
    const to = await aim(action.to, deps);
    const notches = Math.round((from.point.y - to.point.y) / SCROLL_STEP_PX);
    if (notches === 0) return;
    await deps.tool(winArgs.scroll(from.window.hwnd, from.point.x, from.point.y, notches));
    return;
  }

  /**
   * キーを押す（meta-taro/git-qa#10 / #6 の残り）。
   *
   * **ここだけ、相手が前面に一瞬出る。**UI Automation にキーを送る口が無く、
   * `SendInput` は**焦点のある窓へ届く**仕組みなので、出すしかない（2026-09-14・実測）。
   * 送り終えたら**前面は元へ返す。**
   *
   * **キーは、その窓で焦点のある所へ行く。**欄を指した `type`（`SetValue`）は焦点を動かさないので、
   * 「欄に入力してから Enter」と書いても、**その欄に焦点があるとは限らない。**
   */
  if (action.kind === 'key') {
    await deps.tool(winArgs.key(deps.window().hwnd, action.key));
    return;
  }

  throw new AdapterError(KIND, `Windows ではまだ「${action.kind}」を送れない`);
}

/**
 * 1 段をどれだけと見るか。**macOS 側と同じ**にしてある（`(from.y - to.y) / 10`）。
 * 実際に何画素動くかは相手が決めるので、**こちらは回数に直すだけ。**
 */
const SCROLL_STEP_PX = 10;

/** 指す先を画面の座標に直し、**触った場所を画面へ知らせる**（要望シート No.1）。 */
async function aim(
  at: PointerRef,
  deps: DispatchDeps,
): Promise<{ window: WinWindow; point: { x: number; y: number } }> {
  const window = deps.window();
  const point =
    at.at === 'point' ? { x: window.x + at.x, y: window.y + at.y } : await byText(at.ref, deps);

  // 座標は窓の中のもの。
  deps.onPointed?.({
    x: point.x - window.x,
    y: point.y - window.y,
    ...(at.at === 'element' ? { label: at.ref } : {}),
  });

  return { window, point };
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
