import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AdapterError, encodeFrame } from '@git-qa/core';
import type {
  Action,
  ActReport,
  AdapterCapabilities,
  ElementKind,
  LiveView,
  Observation,
  PointerRef,
  RecordingControl,
  Screenshot,
  TargetAdapter,
  TargetSession,
} from '@git-qa/core';

import { fingerprintOf } from '../fingerprint.js';
import { isExactOcrMatch, matchesInOcr, parseOcr } from '../ocr.js';
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
 * | 押す | `AXPress` | **本物のクリック**（#42）。確かめられなければ `Invoke` |
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
  // **種類で絞れる**（#42）。UI Automation の ControlType を道具が返す。
  elementKinds: true,
  // **ダブルクリックを送れる**（#42）。本物のクリックを 2 回。
  doubleClick: true,
  // 窓の持ち主の名前そのもの。**パッケージ名は無い。**
  appId: 'name',
};

/**
 * 外の道具を 1 つ呼ぶ。**出た文字をそのまま返す**（言い換えると原因が絞れなくなる）。
 *
 * **上限を超えたら止めて、理由を言う**（meta-taro/git-qa#42・2026-09-27 の報告）。
 * > 前回の実行を途中で止めると、git-qa-win.exe が残ります。残っていると、次の実行が
 * > **何も出さずに止まり続けます。**
 */
export function runWinTool(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args]);
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      const seconds = String(Math.round(timeoutMs / 100) / 10);
      reject(
        new Error(
          `道具（${args[0] ?? command}）が ${seconds} 秒たっても返らなかったので止めた。` +
            '前の実行の git-qa-win が残っていないかを、タスク マネージャーで見てください',
        ),
      );
    }, timeoutMs);
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (err += c.toString('utf8')));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `${command} が ${String(code)} で終わった`));
    });
  });
}

/** 道具 1 回の上限。**焦点へ打つときは文字数の分だけ延ばす**（1 文字ずつ打つので）。 */
export function winToolTimeoutMs(args: readonly string[]): number {
  const base = 30_000;
  if (args[0] === 'keys') return base + (args[2] ?? '').length * 50;
  return base;
}

export interface WindowsDesktopAdapterOptions extends DesktopAdapterOptions {
  /** `git-qa-win` の場所。**無ければ何もできない**（macOS の OCR と違い、これが本体）。 */
  readonly toolPath: string;
  /**
   * 道具の呼び方を差し替える（**試験のため**）。渡さなければ `toolPath` を起こす。
   *
   * 試験で偽の道具（シェルスクリプト）を起こしていたら、**macOS では新しい実行ファイルを
   * 初めて起こすときの OS の検査で 5 秒を超え、時々落ちた**（2026-09-27）。
   */
  readonly runTool?: (args: readonly string[]) => Promise<string>;
}

export function createWindowsDesktopAdapter(options: WindowsDesktopAdapterOptions): TargetAdapter {
  const now = options.now ?? (() => new Date());
  const tool =
    options.runTool ??
    ((args: readonly string[]): Promise<string> =>
      runWinTool(options.toolPath, args, winToolTimeoutMs(args)));

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

    async act(action: Action): Promise<ActReport | void> {
      ensureOpen();
      return dispatch(action, {
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
async function dispatch(action: Action, deps: DispatchDeps): Promise<ActReport | void> {
  /**
   * **起動する**（meta-taro/git-qa#42）。**窓が出ていれば、何もしない**（macOS と同じ）。
   *
   * 検証シートは、ほぼ必ず 1 行目が「アプリを起動する」。ここに口が無く、**最初の行で止まっていた。**
   *
   * **出ていなければ、起動はしない。**名前から実行ファイルを当てにいくと、
   * **別のものを起こしたまま検証が進みかねない**（C40）。起動していないと言って止まる。
   */
  if (action.kind === 'launch') {
    const running = pickWindow(
      parseWinWindows(await deps.tool(winArgs.windows(action.app))),
      action.app,
    );
    if (running !== undefined) return;
    throw new AdapterError(
      KIND,
      `「${action.app}」は起動していない。Windows では名前から起動しないので、` +
        '先に起動してから走らせてください（別のものを起こさないため）',
    );
  }

  if (action.kind === 'tap') {
    const aimed = await aim(action.target, deps);
    const said = (
      await deps.tool(winArgs.press(aimed.window.hwnd, aimed.point.x, aimed.point.y))
    ).trim();
    return { detail: pressReport(action.target, aimed, said) };
  }

  /**
   * **ダブルクリック**（meta-taro/git-qa#42）。表のセルは、これで編集に入るものが多い。
   * **`Invoke` には落とさない** —— 2 回押す口が無い。確かめられなければ、道具が理由を言って止まる。
   */
  if (action.kind === 'doubleTap') {
    const aimed = await aim(action.target, deps);
    await deps.tool(winArgs.dblclick(aimed.window.hwnd, aimed.point.x, aimed.point.y));
    return { detail: pressReport(action.target, aimed, 'dblclick') };
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
      const said = await deps.tool(winArgs.keys(deps.window().hwnd, action.text));
      return { detail: typedReport(said) };
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
    // **送る直前の焦点の欄**を道具が返す（#42）。どこへキーが入ったかを証跡から読めるように。
    const said = await deps.tool(winArgs.key(deps.window().hwnd, action.key));
    return { detail: keyReport(action.key, said) };
  }

  throw new AdapterError(KIND, `Windows ではまだ「${action.kind}」を送れない`);
}

/**
 * 1 段をどれだけと見るか。**macOS 側と同じ**にしてある（`(from.y - to.y) / 10`）。
 * 実際に何画素動くかは相手が決めるので、**こちらは回数に直すだけ。**
 */
const SCROLL_STEP_PX = 10;

interface Aimed {
  readonly window: WinWindow;
  readonly point: { x: number; y: number };
  /** 文字で指したとき、**当たった行を採る順に**（先頭が押したもの）。 */
  readonly candidates?: readonly OcrLine[];
}

/** 指す先を画面の座標に直し、**触った場所を画面へ知らせる**（要望シート No.1）。 */
async function aim(at: PointerRef, deps: DispatchDeps): Promise<Aimed> {
  const window = deps.window();
  const found = at.at === 'point' ? undefined : await byText(at.ref, deps, at.kind);
  const point = found?.point ?? {
    x: window.x + (at.at === 'point' ? at.x : 0),
    y: window.y + (at.at === 'point' ? at.y : 0),
  };

  // 座標は窓の中のもの。
  deps.onPointed?.({
    x: point.x - window.x,
    y: point.y - window.y,
    ...(at.at === 'element' ? { label: at.ref } : {}),
  });

  return { window, point, ...(found === undefined ? {} : { candidates: found.candidates }) };
}

/** 文字で指された所を探す。**見つからないものを、当てずっぽうで押さない。** */
async function byText(
  text: string,
  deps: DispatchDeps,
  kind?: ElementKind,
): Promise<{ point: { x: number; y: number }; candidates: readonly OcrLine[] }> {
  const lines = await deps.read();
  const candidates = kind === undefined ? matchesInOcr(lines, text) : ofKind(lines, text, kind);
  const [best] = candidates;
  if (best === undefined) {
    throw new AdapterError(KIND, `画面に「${text}」が見つからない`);
  }
  // UI Automation は画面の座標で返す。窓の中へ直さずそのまま使う（押すのも画面の座標）。
  return { point: { x: best.x, y: best.y }, candidates };
}

/**
 * **種類つきで探す**（#42・2026-09-27 の報告 A / C）。
 *
 * > `「2025-01-01」セルをクリックする` → 「2025-01-01 10:00」（DataItem）を押した。
 * > …続く Enter がエディタに入り、**元のファイルが書き換わって保存されました。**
 *
 * 1. **先に種類で絞る**（前は名前で決めた後に絞っていた。別の種類の完全一致が在ると、その種類の候補が消えた）
 * 2. **その中で完全一致だけ。**種類まで書いた人は「その 1 つ」を言い切っている。部分一致に落とすと、
 *    **書いた人が指していないものを押す。**部分一致しか無ければ、押さずに近いものを並べる
 */
function ofKind(lines: readonly OcrLine[], text: string, kind: ElementKind): OcrLine[] {
  const same = lines.filter((one) => ROLES_OF[kind].includes(one.role ?? ''));
  const hits = matchesInOcr(same, text);
  const exact = hits.filter((one) => isExactOcrMatch(one, text));
  if (exact.length > 0) return exact;

  const word = KIND_WORDS[kind];
  if (hits.length > 0) {
    const near = hits
      .slice(0, 3)
      .map((one) => `「${one.text}」`)
      .join('・');
    throw new AdapterError(
      KIND,
      `「${text}」と名前が完全に一致する${word}が無い（近いもの: ${near}）。` +
        '種類を書いたときは、完全に一致するものしか押さない',
    );
  }
  const other = matchesInOcr(lines, text);
  if (other.length > 0) {
    const seen = [...new Set(other.map((one) => one.role ?? '種類不明'))].join(' / ');
    throw new AdapterError(
      KIND,
      `「${text}」という${word}が見つからない（同じ名前は ${seen} に在る）`,
    );
  }
  return [];
}

/**
 * **キーを何へ送ったか**を 1 行で言う（#42）。**値は書かない**（どの欄かが分かれば足りる）。
 *
 * > キーを押す手順に steps[].detail が付きません。どの窓・どの欄にキーが入ったかが証跡から分からず
 */
function keyReport(key: string, said: string): string {
  const [role = '', name = ''] = said.replace(/\n$/, '').split('\t');
  if (role === '' && name === '') return `${key} を送った（焦点の欄は読めなかった）`;
  return `${key} を送った（焦点: ${role}${name === '' ? '' : `「${name}」`}）`;
}

/**
 * **打ったあとの欄の値**を 1 行で言う（meta-taro/git-qa#42 の改善案）。
 *
 * > 「変わらないこと」を確かめる検証でも、人が画像を拡大せずに読めるようになります。
 *
 * 道具は 1 行目に**打ち始めた欄**の `種類 \t 名前 \t 値 \t 印 \t 親の値`、
 * 2 行目に**焦点が移った先**を返す（日付欄は年を打つと月→日へ焦点が進む・2026-09-28）。**パスワード欄は値を返さない**（道具の側で読まない）。
 * **読めなければ、読めなかったと言う**（黙って空にしない）。
 */
function typedReport(said: string): string {
  // 1 行目は**打ち始めた欄**、2 行目は**焦点が移った先**（移っていなければ無い・#42）。
  const [first = '', moved = ''] = said.split('\n');
  const [role = '', name = '', value = '', flag = '', whole = '', settled = ''] = first.split('\t');
  if (role === '' && name === '')
    return '焦点の欄へ 1 文字ずつ打った（打ったあとの値は読めなかった）';

  const field = `焦点の欄（${role}${name === '' ? '' : `「${name}」`}）へ 1 文字ずつ打った`;
  if (flag === 'password') return `${field}（パスワード欄なので、値は書かない）`;

  // **打つ前と同じなら、分かっていることだけを書く**（2026-09-28）。アプリは値を受け取って本文まで
  // 書き換えていたのに、欄全体として読める値だけが前のままだった。**原因（どこを読んでいるか）は未確認。**
  const all =
    whole === ''
      ? ''
      : settled === 'unchanged'
        ? `（欄全体として読める値は打つ前のまま: ${whole}。画面は変わっていることがある）`
        : `（欄全体: ${whole}）`;
  const [toRole = '', toName = '', toValue = '', toFlag = ''] = moved.split('\t');
  const went =
    toRole === '' && toName === ''
      ? ''
      : `。焦点は ${toRole}${toName === '' ? '' : `「${toName}」`}へ移った` +
        (toFlag === 'password' ? '' : `（値: ${toValue}）`);
  return `${field}。打ったあとの値: ${value}${all}${went}`;
}

/**
 * 種類と、UI Automation の ControlType の名前（#42）。
 * **セル（`DataItem`）は実物で確かめていない**（Chromium の `gridcell` がそう出る、という前提）。
 */
const ROLES_OF: Readonly<Record<ElementKind, readonly string[]>> = {
  button: ['Button', 'SplitButton'],
  link: ['Hyperlink'],
  menuitem: ['MenuItem'],
  tab: ['TabItem'],
  checkbox: ['CheckBox'],
  cell: ['DataItem'],
};

const KIND_WORDS: Readonly<Record<ElementKind, string>> = {
  button: 'ボタン',
  link: 'リンク',
  menuitem: 'メニュー',
  tab: 'タブ',
  checkbox: 'チェックボックス',
  cell: 'セル',
};

/**
 * **何をどう押したか**を 1 行で言う（meta-taro/git-qa#42）。証跡の手順の足跡に付く。
 *
 * > 候補が 2 つ以上あったら、選んだものを証跡に書く（種類・名前・座標）。
 * > 本物のクリックは…証跡に残しておくと、人が触っていたときの誤作動を切り分けやすくなります。
 */
function pressReport(target: PointerRef, aimed: Aimed, said: string): string {
  const how =
    said === 'dblclick'
      ? 'ダブルクリックした'
      : said === 'invoke'
        ? 'Invoke で押した（本物のクリックは確かめられなかった）'
        : '本物のクリックで押した';
  const at = `（${String(Math.round(aimed.point.x))}, ${String(Math.round(aimed.point.y))}）`;
  const picked = aimed.candidates?.[0];
  if (target.at === 'point' || picked === undefined) return `座標${at}を${how}`;

  const kind = picked.role === undefined ? '' : `（${picked.role}）`;
  const head = `「${picked.text}」${kind}を${how}${at}`;
  const all = aimed.candidates ?? [];
  if (all.length < 2) return head;
  const roles = all.map((one) => one.role ?? '種類不明').join(' / ');
  return `${head}。同じ名前が ${String(all.length)} つ（${roles}）。いちばん小さいものを採った`;
}

export { KIND as WINDOWS_DESKTOP_KIND };
