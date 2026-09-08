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

import { axScript, findInElements, manualAccessibilityScript, parseElements } from './ax.js';
import { clickScript, dragScript, NOT_FRONT_MARK, scrollScript } from './click.js';
import type { AxElement } from './ax.js';
import { findInOcr, parseOcr } from './ocr.js';
import { explainToolFailure } from './permission.js';
import type { OcrLine } from './ocr.js';
import {
  anyWindowScript,
  captureArgs,
  missingWindowMessage,
  notFrontmost,
  parseWindow,
  windowScript,
} from './window.js';
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
  /**
   * **AI がどこを触ったかを知らせる**（要望シート No.1）。
   *
   * それまで、触った場所はここから外へ出ていなかった。人の画面が「ここ」と指せるように、
   * **映像の中の座標**（窓の左上を 0 とする）で渡す。
   */
  readonly onPointed?: (at: { x: number; y: number; label?: string }) => void;
  /**
   * 画面を触る実行ファイル（`git-qa-input`）。
   * **無ければ、前面へ出して画面の座標を押す道**へ落ちる（人には相手が前面に出て見える）。
   */
  readonly inputPath?: string;
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
        const elsewhere = Number((await osa(anyWindowScript(options.app)).catch(() => '0')).trim());
        throw new AdapterError(
          KIND,
          missingWindowMessage(options.app, Number.isFinite(elsewhere) ? elsewhere : 0),
        );
      }
      /**
       * **中身を出してもらってから始める。**
       *
       * Electron / Chromium は聞かれるまで木を作らない。作っていない相手には、
       * 段 1 が空になるうえ、押すと `-25211`（補助アクセスは許可されません）が返る。
       * **許可はあるのに、その文言で返るので、原因の見当がまるで違う方へ向く。**
       *
       * **失敗は握り潰す。**この属性を持たないアプリ（普通の Mac アプリ）では
       * 必ず失敗し、そちらは何もしなくても最初から中身が見えている。
       * ここで止めると、Electron でない相手が全部通らなくなる。
       */
      await run('osascript', ['-e', manualAccessibilityScript(options.app)]).catch(() => undefined);

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

  /**
   * 押すときに使う窓の位置。**映像が流れている間は、それが取り直している。**
   *
   * osascript は 1 回 250 ms かかる（実測 2026-09-07）。映像は 8 枚/秒で
   * 窓を取り直しているので、**その値を使えば 1 押しぶんの待ちが丸ごと消える。**
   * 古すぎるときだけ取り直す。
   */
  const WINDOW_FRESH_MS = 400;
  let windowAt = 0;
  const recentWindow = async (): Promise<WindowRef> =>
    Date.now() - windowAt < WINDOW_FRESH_MS ? window : refreshWindow();

  /** 窓の位置は動く。**撮る前に取り直す**（動かしたまま古い場所を撮らない）。 */
  const refreshWindow = async (): Promise<WindowRef> => {
    const found = parseWindow(await osa(windowScript(app)));
    if (found === undefined) {
      // **「無い」と「見えていない」を分ける。**別のデスクトップ（Space）へ移しただけで
      // ここは空になる。「閉じられていないか」と言うと、閉じていない窓を探しに行かせる。
      const elsewhere = Number((await osa(anyWindowScript(app)).catch(() => '0')).trim());
      throw new AdapterError(
        KIND,
        missingWindowMessage(app, Number.isFinite(elsewhere) ? elsewhere : 0),
      );
    }
    window = found;
    windowAt = Date.now();
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
      await dispatch(app, action, look, recentWindow, deps.inputPath, deps.onPointed);
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
  lookWindow: () => Promise<WindowRef>,
  /** 触る場所が決まったら知らせる（要望シート No.1）。**人が「ここ」と見られるように。** */
  onPointed?: (at: { x: number; y: number; label?: string }) => void,
): Promise<{ x: number; y: number }> {
  if (ref.at === 'point') {
    /**
     * **点で指されているなら、撮らないし読まない。**
     *
     * 人がライブビューを押したときがこれ。要るのは窓の左上だけで、
     * 画面の文字は 1 つも要らない。
     * 2026-09-07、ここで毎回 `look()` していたので **1 押しに OCR が 1 秒**かかり、
     * 「反応したのか、遅れているのか分からない」と言われた（実測 988 ms / 回）。
     */
    const window = await lookWindow();
    // 窓の中の座標として受け取る。**画面の座標へ戻す。**
    return { x: window.x + ref.x, y: window.y + ref.y };
  }

  const seen = await look();

  const byAx = findInElements(seen.elements, ref.ref);
  if (byAx !== undefined) {
    // **窓の左上を 0 とした座標で知らせる**（映像の中の座標と同じ数え方）。
    onPointed?.({ x: byAx.x - seen.window.x, y: byAx.y - seen.window.y, label: ref.ref });
    return byAx;
  }

  const byOcr = findInOcr(seen.ocr, ref.ref);
  if (byOcr !== undefined) {
    // 絵の画素 → 窓の中 → 画面。**Retina では絵が 2 倍の大きさで返る。**
    const inWindow = { x: Math.round(byOcr.x / seen.scale), y: Math.round(byOcr.y / seen.scale) };
    onPointed?.({ ...inWindow, label: ref.ref });
    return { x: seen.window.x + inWindow.x, y: seen.window.y + inWindow.y };
  }

  throw new AdapterError(KIND, `画面に見つからない要素: ${JSON.stringify(ref.ref)}`);
}

async function dispatch(
  app: string,
  action: Action,
  look: () => Promise<Seen>,
  /** 窓の位置だけを取る安い道。**点で指されたときは、これで足りる。** */
  lookWindow: () => Promise<WindowRef>,
  /** 前面に出さずに押す道具。**無ければ前から在る道へ落ちる。** */
  inputPath: string | undefined,
  /** 触る場所が決まったら知らせる（要望シート No.1）。 */
  onPointed: ((at: { x: number; y: number; label?: string }) => void) | undefined,
): Promise<void> {
  if (action.kind === 'launch') {
    /**
     * **書いてあるものだけを開く。**表示名からの推測はしない（C40）。
     *
     * **もう窓が出ているなら、何もしない。**
     * 実物の検証シートは、ほぼ全部のケースが「アプリを起動する」で始まる。
     * ここで毎回 `activate()` していたので、**人が判定を 1 件置くたびに相手が前面へ出ていた**
     * （2026-09-07「キーボード押すたびに相手のアプリが前にくるのじゃまですw」）。
     *
     * 見るのに前面は要らない（窓の番号で撮っている）。**出ていないときだけ起こす。**
     */
    const already = parseWindow(await osa(windowScript(action.app)).catch(() => ''));
    if (already !== undefined) return;

    await osa(`Application(${JSON.stringify(action.app)}).activate()`);
    return;
  }

  /**
   * **見るだけなら前面に出さない。**
   *
   * 2026-09-06、人から報告があった:
   * 「チャット欄に書き込もうとしてフォーカス当てると、実際のアプリに移動しちゃうね」。
   * 操作のたびに `activate()` していたので、**人が別の窓に打っている最中でも奪っていた。**
   * **検証は人の作業の上で走る。**人の手を止める道具は、それだけで使われなくなる。
   *
   * **ただし押すときは別**（2026-09-07 に実測して戻した・`clickAt`）。
   * 押すのは画面全体の座標なので、隠れていれば手前の別アプリが受け取る。
   * 実際に Google Chrome のツールバーと warifu の窓を押していた。
   * **奪わないことより、別のアプリを押さないことが先。**
   */
  if (action.kind === 'type') {
    if (action.target !== undefined) {
      const point = await resolvePoint(action.target, look, lookWindow, onPointed);
      await clickAt(point, await lookWindow(), app, inputPath);
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
    await clickAt(
      await resolvePoint(action.target, look, lookWindow, onPointed),
      await lookWindow(),
      app,
      inputPath,
    );
    return;
  }

  if (action.kind === 'drag') {
    /**
     * **掴んで運ぶ。**押すのと違い、AX には口が無いので実際のマウス操作を送る。
     * そのため**1 回だけ前面に出て、指も実際に動く**（途中で焦点が動くと、掴んだものが落ちる）。
     * 道具がある場合は、**終わったら指と前面を元へ返す。**
     */
    const from = await resolvePoint(action.from, look, lookWindow, onPointed);
    const to = await resolvePoint(action.to, look, lookWindow, onPointed);
    const window = await lookWindow();
    if (inputPath !== undefined) {
      const done = await run(inputPath, [
        'drag',
        String(window.pid),
        String(Math.round(from.x)),
        String(Math.round(from.y)),
        String(Math.round(to.x)),
        String(Math.round(to.y)),
      ]).then(
        () => true,
        () => false,
      );
      if (done) return;
    }
    await osa(dragScript(app, from.x, from.y, to.x, to.y));
    return;
  }

  // swipe。デスクトップではスクロールとして送る（指でなぞる相手ではない）。
  const from = await resolvePoint(action.from, look, lookWindow, onPointed);
  const to = await resolvePoint(action.to, look, lookWindow, onPointed);
  const amount = Math.round((from.y - to.y) / 10);
  if (amount === 0) return;

  /**
   * **なぞるのは、前面に出さずにできる**（2026-09-07 実測）。
   * 指は一度その場所へ運ぶ必要があるが、**終わったら元へ返す。**
   * 人にこう言われた: 「スクロールと、DnDのときだけ一瞬前面にでるのかまうすぽいんたがとびます」。
   */
  if (inputPath !== undefined) {
    const done = await run(inputPath, [
      'scroll',
      String(Math.round(from.x)),
      String(Math.round(from.y)),
      String(-amount),
    ]).then(
      () => true,
      () => false,
    );
    if (done) return;
  }
  await osa(scrollScript(app, from.x, from.y, amount));
}

/**
 * 押す。**押す前に、その点の最前面が目的の窓かを確かめる。**
 *
 * 撮るほうは `screencapture -l <窓番号>` なので、重なっていても目的の窓だけが写る。
 * **押すほうは画面全体の座標で送るので、隠れていれば手前の別アプリが受け取る。**
 * 映像には目的の窓が写ったまま、押した先だけが別、という形になる。
 */
/**
 * **中身を出してくれと頼む。**ただし毎回は頼まない。
 *
 * 1 回 260 ms かかる（実測 2026-09-07）。Chromium が木を畳むのは分単位なので、
 * **数秒に 1 回で足りる。**押すたびに頼むと、そのぶん人が待つ。
 */
const CONTENT_ASK_INTERVAL_MS = 5_000;
let lastAsked = 0;
const askForContent = async (app: string): Promise<void> => {
  const at = Date.now();
  if (at - lastAsked < CONTENT_ASK_INTERVAL_MS) return;
  lastAsked = at;
  await run('osascript', ['-e', manualAccessibilityScript(app)]).catch(() => undefined);
};

const clickAt = async (
  point: { x: number; y: number },
  window: WindowRef,
  app: string,
  inputPath: string | undefined,
): Promise<void> => {
  /**
   * **前面に出さずに押す**（C57 追記・2026-09-07）。
   *
   * `git-qa-input` はアクセシビリティの要素を直接押す。相手を前面へ出す必要が無く、
   * 隠れたままでも押せる。**99 ms**（前面へ出す道は 520 ms、その前は 3 秒超だった）。
   *
   * **押せない場所もある**（絵で描かれているだけの所には、押せる部品が無い）。
   * そのときだけ、前から在る道（前面へ出して画面の座標を押す）へ落とす。
   */
  if (inputPath !== undefined) {
    const pressed = await run(inputPath, [
      'press',
      String(window.pid),
      String(Math.round(point.x)),
      String(Math.round(point.y)),
    ]).then(
      () => true,
      () => false,
    );
    if (pressed) return;
  }

  // **中身を出してくれと頼む**（Electron は聞かれるまで木を作らない・C57）。5 秒に 1 回で足りる。
  await askForContent(app);

  // **前面へ出す・出るのを待つ・押す。1 本で済ませる**（分けると 1 押しが 1 秒を超える）。
  const said = (await run('osascript', ['-e', clickScript(app, point.x, point.y)])).trim();
  if (said.startsWith(NOT_FRONT_MARK)) {
    const front = said.slice(NOT_FRONT_MARK.length).trim();
    throw new AdapterError(KIND, notFrontmost(app, front) ?? `${app} を前面に出せなかった`);
  }
};
