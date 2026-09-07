import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  TargetBuild,
  TargetSession,
} from '@git-qa/core';

import { axScript, findInElements, parseElements } from './ax.js';
import type { AxElement } from './ax.js';
import { findInOcr, parseOcr } from './ocr.js';
import { explainToolFailure } from './permission.js';
import type { OcrLine } from './ocr.js';
import { captureArgs, parseWindow, windowScript } from './window.js';
import type { WindowRef } from './window.js';

/**
 * 手元のデスクトップアプリを見て触る（C55 / Issue 016）。
 *
 * **アプリの作りで線を引かない。**触れ方を段で持ち、上から順に試す。
 *
 * | 段 | 手 | 実測（2026-09-06・warifu = Tauri） |
 * |---|---|---|
 * | 1 | アクセシビリティ | 8 個 / 1,322 ms |
 * | 2 | 絵から文字を読む | **29 行 / 1,149 ms** |
 *
 * **読むときは両方見る。**Tauri は AX に浅くしか出さないので、AX だけだと取りこぼす。
 * **触るときは AX を先に見る。**名前が取れているなら、そちらのほうが確か（OCR は読み違える）。
 */

const KIND = 'desktop';

/** 1 枚撮るのにかかる時間（実測 118 ms）。**これより短い間隔で回しても意味が無い。** */
const FRAME_INTERVAL_MS = 120;

const capabilities: AdapterCapabilities = {
  // macOS のアクセシビリティ。DOM でもアクセシビリティツリーでもない（C24）。
  observation: 'ui-automation',
  // 録画はまだ持たない。**「できない」を黙って `failed` にしない**（C20）。
  recording: false,
  // `keystroke` は IME を通すので、日本語もそのまま送れる。
  textInput: 'any',
  // 窓の持ち主の名前そのもの。**パッケージ名は無い。**
  appId: 'name',
};

export interface DesktopAdapterOptions {
  /** 見るアプリ。**窓の持ち主の名前**（`warifu` / `計算機` など）。 */
  readonly app: string;
  readonly build: TargetBuild;
  /** OCR を呼ぶ実行ファイル。無ければ段 2 は使えない（段 1 だけで動く）。 */
  readonly ocrPath?: string;
  readonly now?: () => Date;
}

/** 外の道具を 1 つ呼ぶ。**出た文字をそのまま返す**（言い換えると原因が絞れなくなる）。 */
function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args]);
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(out);
        return;
      }
      reject(new AdapterError(KIND, explainToolFailure(command, err)));
    });
  });
}

const osa = (script: string): Promise<string> =>
  run('osascript', ['-l', 'JavaScript', '-e', script]);

export function createDesktopAdapter(options: DesktopAdapterOptions): TargetAdapter {
  const now = options.now ?? (() => new Date());

  return {
    kind: KIND,
    capabilities,

    async connect(): Promise<TargetSession> {
      const window = parseWindow(await osa(windowScript(options.app)));
      if (window === undefined) {
        // **黙って空の絵を返さない。**見つからないことと、何も映っていないことは別。
        throw new AdapterError(
          KIND,
          `窓が見つからない: ${options.app}。アプリを起動して、窓を出してから始める` +
            '（名前は窓の持ち主のもの。「情報を見る」の名前とは違うことがある）',
        );
      }
      return createSession({ ...options, now, window });
    },
  };
}

interface SessionDeps extends DesktopAdapterOptions {
  readonly now: () => Date;
  readonly window: WindowRef;
}

/** 画面の見え方。**段 1 と段 2 の両方を持つ**（片方だけだと取りこぼす）。 */
interface Seen {
  readonly elements: readonly AxElement[];
  readonly ocr: readonly OcrLine[];
  /** 絵の画素と、画面の座標の比。**Retina では 2 になる。** */
  readonly scale: number;
  readonly window: WindowRef;
}

function createSession(deps: SessionDeps): TargetSession {
  const { app, build, now } = deps;
  let window = deps.window;
  let closed = false;
  let liveOpen = false;

  const ensureOpen = (): void => {
    if (closed) throw new AdapterError(KIND, 'アプリとの接続はもう閉じている');
  };

  /** 窓の位置は動く。**撮る前に取り直す**（動かしたまま古い場所を撮らない）。 */
  const refreshWindow = async (): Promise<WindowRef> => {
    const found = parseWindow(await osa(windowScript(app)));
    if (found === undefined) {
      throw new AdapterError(KIND, `窓が見つからなくなった: ${app}（閉じられていないかを見る）`);
    }
    window = found;
    return found;
  };

  const shoot = async (): Promise<{ bytes: Uint8Array; scale: number; window: WindowRef }> => {
    const target = await refreshWindow();
    const dir = await mkdtemp(join(tmpdir(), 'git-qa-desktop-'));
    const path = join(dir, 'frame.jpg');
    try {
      await run('screencapture', captureArgs(target.id, path));
      const bytes = new Uint8Array(await readFile(path));
      const sized = await run('sips', ['-g', 'pixelWidth', path]).catch(() => '');
      const pixels = Number(/pixelWidth:\s*(\d+)/.exec(sized)?.[1] ?? target.width);
      return { bytes, scale: pixels > 0 ? pixels / target.width : 1, window: target };
    } finally {
      // 撮った絵は残さない。**人の temp に溜まり続けるのは、頼まれていない。**
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  /** **段 1 と段 2 の両方を読む。**片方が空でも、もう片方で見える。 */
  const look = async (): Promise<Seen> => {
    const shot = await shoot();
    const [axOut, ocrOut] = await Promise.all([
      osa(axScript(app)).catch(() => ''),
      readOcr(deps.ocrPath, shot.bytes).catch(() => ''),
    ]);
    return {
      elements: parseElements(axOut),
      ocr: parseOcr(ocrOut),
      scale: shot.scale,
      window: shot.window,
    };
  };

  const liveView: LiveView = {
    get isOpen() {
      return liveOpen;
    },
    transport: { kind: 'image-frames', label: `screencapture ${app}`, mimeType: 'image/jpeg' },
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
        reason: 'デスクトップの録画はまだ持っていない',
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
      await dispatch(app, action, look);
    },

    async observe(): Promise<Observation> {
      ensureOpen();
      const seen = await look();
      // **どちらの段で見たかを潰さない。**後から「何を根拠に判断したか」を読めるようにする。
      return {
        kind: KIND,
        capturedAt: now().toISOString(),
        raw: {
          elements: seen.elements,
          ocr: seen.ocr,
          text: screenTextOf(seen),
        },
      };
    },

    async screenshot(): Promise<Screenshot> {
      ensureOpen();
      const shot = await shoot();
      return { format: 'png', bytes: shot.bytes, capturedAt: now().toISOString() };
    },

    close(): Promise<void> {
      closed = true;
      liveOpen = false;
      // **アプリは閉じない。**人が開いていたものを、こちらの都合で落とさない。
      return Promise.resolve();
    },
  };
}

/** 段 1 と段 2 で読めた文字を並べる。**どちらか片方では取りこぼす。** */
export function screenTextOf(seen: {
  readonly elements: readonly AxElement[];
  readonly ocr: readonly OcrLine[];
}): string {
  const lines = [...seen.elements.map((el) => el.name), ...seen.ocr.map((line) => line.text)];
  // 同じ文字が両方から出るので、並びを保ったまま重複を落とす。
  return [...new Set(lines)].join('\n');
}

async function readOcr(ocrPath: string | undefined, bytes: Uint8Array): Promise<string> {
  if (ocrPath === undefined) return '';
  const dir = await mkdtemp(join(tmpdir(), 'git-qa-ocr-'));
  const path = join(dir, 'frame.jpg');
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, bytes);
    return await run(ocrPath, [path]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * 触る場所を決める。**段 1 を先に見る** —— 名前が取れているなら、そちらが確か。
 * 取れていなければ絵から読んだ文字（段 2）。**どちらにも無ければ、そう言って止まる。**
 */
async function resolvePoint(
  ref: PointerRef,
  look: () => Promise<Seen>,
): Promise<{ x: number; y: number }> {
  const seen = await look();
  if (ref.at === 'point') {
    // 窓の中の座標として受け取る。**画面の座標へ戻す。**
    return { x: seen.window.x + ref.x, y: seen.window.y + ref.y };
  }

  const byAx = findInElements(seen.elements, ref.ref);
  if (byAx !== undefined) return byAx;

  const byOcr = findInOcr(seen.ocr, ref.ref);
  if (byOcr !== undefined) {
    // 絵の画素 → 窓の中 → 画面。**Retina では絵が 2 倍の大きさで返る。**
    return {
      x: Math.round(seen.window.x + byOcr.x / seen.scale),
      y: Math.round(seen.window.y + byOcr.y / seen.scale),
    };
  }

  throw new AdapterError(KIND, `画面に見つからない要素: ${JSON.stringify(ref.ref)}`);
}

async function dispatch(app: string, action: Action, look: () => Promise<Seen>): Promise<void> {
  if (action.kind === 'launch') {
    // **書いてあるものだけを開く。**表示名からの推測はしない（C40）。
    // ここだけは前面に出す —— シートが「起動する」と書いているので、人も承知している。
    await osa(`Application(${JSON.stringify(action.app)}).activate()`);
    return;
  }

  /**
   * **毎回は前面に出さない。**
   *
   * 2026-09-06、人から報告があった:
   * 「チャット欄に書き込もうとしてフォーカス当てると、実際のアプリに移動しちゃうね」。
   * 操作のたびに `activate()` していたので、**人が別の窓に打っている最中でも奪っていた。**
   *
   * **検証は人の作業の上で走る。**人の手を止める道具は、それだけで使われなくなる。
   * 前面に出すのは、シートが「起動する」と書いたときだけにする。
   */
  if (action.kind === 'type') {
    if (action.target !== undefined) {
      const point = await resolvePoint(action.target, look);
      await clickAt(point);
    }
    // `keystroke` は IME を通すので、日本語もそのまま入る。
    await run('osascript', [
      '-e',
      `tell application "System Events" to keystroke ${JSON.stringify(action.text)}`,
    ]);
    return;
  }

  if (action.kind === 'key') {
    await run('osascript', [
      '-e',
      `tell application "System Events" to keystroke ${JSON.stringify(action.key)}`,
    ]);
    return;
  }

  if (action.kind === 'tap') {
    await clickAt(await resolvePoint(action.target, look));
    return;
  }

  if (action.kind === 'drag') {
    // **持っていない。**できないことを、別の操作へ黙って流さない（C20 と同じ考え方）。
    throw new AdapterError(
      KIND,
      'デスクトップではドラッグをまだ持っていない（人が自分で動かす必要がある）',
    );
  }

  // swipe。デスクトップではスクロールとして送る（指でなぞる相手ではない）。
  const from = await resolvePoint(action.from, look);
  const to = await resolvePoint(action.to, look);
  const amount = Math.round((from.y - to.y) / 10);
  await run('osascript', [
    '-e',
    `tell application "System Events" to scroll {0, ${String(amount)}} at {${String(from.x)}, ${String(from.y)}}`,
  ]);
}

const clickAt = (point: { x: number; y: number }): Promise<string> =>
  run('osascript', [
    '-e',
    `tell application "System Events" to click at {${String(point.x)}, ${String(point.y)}}`,
  ]);
