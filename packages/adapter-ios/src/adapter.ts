import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AdapterError } from '@git-qa/core';
import type {
  Action,
  ActReport,
  AdapterCapabilities,
  LiveView,
  Observation,
  RecordingControl,
  Screenshot,
  TargetAdapter,
  TargetBuild,
  TargetSession,
} from '@git-qa/core';

import { framesFrom, iosArgs, parseIosToolDevices, type IosDevice } from './tool.js';
import { createWdaClient, pickByText, toPoints, type WdaClient } from './wda.js';

/**
 * iPhone / iPad を **USB 越しに映して見る**アダプタ（2026-09-19・人の指示）。
 *
 * Android と同じく、iPhone / iPad でも検証を録画できるようにする。
 *
 * ## 持っているもの・持っていないもの
 *
 * | | |
 * |---|---|
 * | **見る** | ✅ USB で映す（端末に何も入れない） |
 * | **読む** | ✅ 絵から文字を読む（`git-qa-ocr`・C55 の段 2） |
 * | **押す・打つ** | **WebDriverAgent の口を渡したときだけ**（`GIT_QA_IOS_WDA`・C99）。署名して端末へ入れ、起こすのは人の作業。**実機では未確認** |
 * | **録る** | ✅ 流れてくる絵をそのまま残せる（Android と違い、OS の録画を借りない） |
 *
 * **押せないことを黙らない。**`act` は理由を言って止まる ——
 * 「操作できるつもりで planning が回る」と、**人にも機械にも何が起きたか分からない。**
 *
 * ## 実機で測った（2026-09-25・人が iPhone を繋いだ）
 *
 * | | |
 * |---|---|
 * | 一覧 | ✅ 1 台 |
 * | 1 枚撮る | ✅ 1206x2622・110 KB・**2.7 秒** |
 * | 読む（OCR） | ✅ 8 行・位置と大きさ付き・**1.45 秒** |
 * | 流す | ✅ **5.5 枚/秒・0.54 MB/秒**・取りこぼし 0 |
 *
 * **踏んだ穴はカメラの許可。**iPhone / iPad は「撮影機器」として現れるので、
 * `NSCameraUsageDescription` が無いと **OS は許可を聞く画面すら出さず、
 * 一覧が黙って 0 台になる。**USB でも `devicectl` でも見えていて、
 * QuickTime では映っていたのに、git-qa からだけ「端末が無い」に見えていた。
 * 道具は**許可が無いならそう言って止まる**ようにした（0 台を黙って返さない）。
 *
 * **絞りも実機で決めた。**絞らずに流すと **49.7 枚/秒・毎秒およそ 5 MB** 出ていた。
 * 人が見て判断するのに 50 枚/秒は要らない（`IOS_FRAME_INTERVAL_MS`）。
 *
 * ## 人が先にやること（iOS だけ）
 *
 * - **自動ロックを「なし」に**（設定 → 画面表示と明るさ）。映している最中に画面が落ちると切れる
 * - 端末側で「このコンピュータを信頼」
 * - **他のアプリが掴んでいないこと**（QuickTime の「ムービー収録」は閉じる）
 */

const KIND = 'ios' as const;

/**
 * 端末の識別子を、**同じか違うかだけ分かる形**に潰す。
 *
 * **証跡は人に渡る。**端末を特定できる値をそのまま残さない（§25）。
 * 入れ替わりを見るのに要るのは「同じか違うか」だけ。
 */
function shortenId(id: string): string {
  let hash = 0;
  for (const code of id) hash = (hash * 31 + code.charCodeAt(0)) | 0;
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export const IOS_CAPABILITIES: AdapterCapabilities = {
  // **AX 木は取れない**（WebDriverAgent が要る）。絵から文字を読む。
  observation: 'none',
  /**
   * **この旗は「アダプタ自身が録れるか」**（ウェブも同じ仕組みで `false` と名乗っている）。
   *
   * iOS の録画は**流れてくる絵から宿主が作る**（`frame-recording.ts`・`image-frames` の道）。
   * **アダプタは録らない。**ここで `true` と名乗ると、**録れないものを録れると言うことになる。**
   */
  recording: false,
  // **押す口が無いので、文字も送れない。**`ascii-only` と名乗らせない（C20 の考え方）。
  textInput: 'none',
  keyInput: false,
  // 行き先はアプリ名でもパッケージ名でもなく、**人が端末で開く。**
  // いまは「何を見たか」を名前で書いてもらう。
  appId: 'name',
};

export interface IosAdapterOptions {
  /** `git-qa-ios` の場所。**無ければ、この相手は見られない。** */
  readonly toolPath: string;
  readonly build: TargetBuild;
  /** 端末の識別子。**省くと、最初に見つかったもの。** */
  readonly device?: string;
  /** 絵から文字を読む道具（`git-qa-ocr`）。**無ければ文字は読めない。** */
  readonly ocrPath?: string;
  /** 何を見に行ったか（シートの `行き先`・#22）。 */
  readonly destination?: string;
  readonly now?: () => Date;
  /**
   * **押す口**（WebDriverAgent の URL・例 `http://127.0.0.1:8100`・C99）。
   * 署名して端末へ入れ、起こすのは人の作業。**無ければ、今までどおり見る・読むだけ。**
   */
  readonly wdaUrl?: string;
}

/**
 * 名乗る能力。**押す口（WDA）があるときだけ、打てると名乗る**（C99）。
 * 口が無いのに名乗ると、planning が「操作できる」つもりで回る（C20）。
 */
export function iosCapabilities(canPress: boolean): AdapterCapabilities {
  return canPress ? { ...IOS_CAPABILITIES, textInput: 'any' } : IOS_CAPABILITIES;
}

/** `iosAct` が要るもの。**試験で差し替えられるように、撮る・読むを 1 つにまとめてある。** */
export interface IosActDeps {
  readonly wda: WdaClient | undefined;
  /** いまの画面を撮って、絵から読んだ文字（`文字 \t x \t y \t 幅 \t 高さ`）を返す。 */
  readonly look: () => Promise<string>;
}

/**
 * **押す・打つを WebDriverAgent に頼む**（C99）。何をどう押したかを返す（証跡の手順に付く）。
 *
 * **口が無ければ、理由を言って止まる**（C20）。見つからない文字は押さない。
 */
export async function iosAct(action: Action, deps: IosActDeps): Promise<ActReport> {
  const { wda } = deps;
  if (wda === undefined) {
    throw new AdapterError(
      KIND,
      `iPhone / iPad を操作する口が無い（${action.kind}）。WebDriverAgent を端末で起こし、` +
        'GIT_QA_IOS_WDA にその URL を渡すと押せます。無いあいだは、人が端末を触り、git-qa が見て、人が判定を置いてください',
    );
  }

  /** 押す点を、画素からポイントへ。文字なら絵から探す。 */
  const aim = async (
    target: Extract<Action, { kind: 'tap' }>['target'],
  ): Promise<{ pt: { x: number; y: number }; label: string }> => {
    const scale = await wda.scale();
    if (target.at === 'point') {
      return { pt: toPoints(target, scale), label: '座標' };
    }
    const found = pickByText(await deps.look(), target.ref);
    if (found === undefined) {
      throw new AdapterError(
        KIND,
        `画面に「${target.ref}」が見つからない（絵から読んだ文字で探した）`,
      );
    }
    return { pt: toPoints(found, scale), label: `「${target.ref}」` };
  };
  const at = (pt: { x: number; y: number }): string =>
    `（${String(Math.round(pt.x))}, ${String(Math.round(pt.y))}）`;

  if (action.kind === 'tap') {
    const { pt, label } = await aim(action.target);
    await wda.tap(pt);
    return { detail: `${label}を WebDriverAgent で押した${at(pt)}` };
  }

  if (action.kind === 'type') {
    if (action.target !== undefined) {
      const { pt } = await aim(action.target);
      await wda.tap(pt);
    }
    await wda.type(action.text);
    return { detail: '焦点の欄へ WebDriverAgent で打った' };
  }

  if (action.kind === 'swipe') {
    const from = await aim(action.from);
    const to = await aim(action.to);
    const ms = action.durationMs ?? 300;
    await wda.swipe(from.pt, to.pt, ms);
    return { detail: `WebDriverAgent でなぞった${at(from.pt)}→${at(to.pt)}` };
  }

  throw new AdapterError(KIND, `iPhone / iPad には、まだ送れない操作（${action.kind}）`);
}

const runTool = (toolPath: string, args: readonly string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(toolPath, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      // **道具の言い分をそのまま通す。**言い換えると、人が次に何をすればよいか分からなくなる。
      else
        reject(
          new Error(err.trim() === '' ? `git-qa-ios が ${String(code)} で終わった` : err.trim()),
        );
    });
  });

/** つながっている端末を並べる。**0 台は「無い」であって「測れなかった」ではない。** */
/**
 * 映せる端末の一覧。**空なら、間を置いて道具を起こし直す**（2026-10-07・実機で測った）。
 *
 * 前のプロセスが端末を手放した直後は、新しいプロセスから **10 秒以上**見えなくなる。
 * その最中に始まったプロセスは待ち続けても見つけられないので、**起こし直す**しかない。
 * 既定は 3 秒おきに 10 回（最長 30 秒ほど）。見えればすぐ返す。
 */
export async function listIosDevices(
  toolPath: string,
  options: {
    readonly attempts?: number;
    readonly gapMs?: number;
    readonly run?: (args: readonly string[]) => Promise<string>;
  } = {},
): Promise<IosDevice[]> {
  const attempts = options.attempts ?? 10;
  const gapMs = options.gapMs ?? 3_000;
  const run = options.run ?? ((args: readonly string[]) => runTool(toolPath, args));
  for (let i = 0; i < attempts; i++) {
    const found = parseIosToolDevices(await run(iosArgs.devices()));
    if (found.length > 0 || i === attempts - 1) return found;
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  return [];
}

export function createIosAdapter(options: IosAdapterOptions): TargetAdapter {
  const now = options.now ?? ((): Date => new Date());

  return {
    kind: KIND,
    capabilities: iosCapabilities(options.wdaUrl !== undefined),
    async connect(): Promise<TargetSession> {
      const devices = await listIosDevices(options.toolPath);
      const device =
        options.device === undefined
          ? devices[0]
          : devices.find((d) => d.id === options.device || d.name === options.device);
      if (device === undefined) {
        throw new AdapterError(
          KIND,
          devices.length === 0
            ? '映せる端末が無い（USB で繋ぎ、端末側で「このコンピュータを信頼」を済ませてください）'
            : `その端末が見つからない: ${String(options.device)}`,
        );
      }
      return createIosSession({ ...options, device, now });
    },
  };
}

interface SessionDeps extends Omit<IosAdapterOptions, 'device'> {
  readonly device: IosDevice;
  readonly now: () => Date;
}

function createIosSession(deps: SessionDeps): TargetSession {
  const wda = deps.wdaUrl === undefined ? undefined : createWdaClient(deps.wdaUrl);
  let closed = false;
  let liveOpen = false;
  let streaming: ChildProcess | undefined;

  const ensureOpen = (): void => {
    if (closed) throw new AdapterError(KIND, '端末との接続はもう閉じている');
  };

  const shoot = async (): Promise<Screenshot> => {
    ensureOpen();
    /**
     * **押す口（WDA）があるなら、絵も WDA から取る**（2026-10-07・実機で踏んだ）。
     * USB で映す道具は、前のプロセスが端末を手放した直後に 10 秒以上見えなくなる。
     * 手順ごとに撮ると**必ずその隙間に落ちて「映せる端末が無い」**になった。
     * 人が見る映像（ライブビュー）は、長く動く 1 本なので、これまでどおり USB で映す。
     */
    if (wda !== undefined) {
      return { format: 'png', bytes: await wda.screenshot(), capturedAt: deps.now().toISOString() };
    }
    const dir = await mkdtemp(join(tmpdir(), 'git-qa-ios-'));
    const path = join(dir, 'screen.jpg');
    try {
      await runTool(deps.toolPath, iosArgs.shoot(deps.device.id, path));
      const { readFile } = await import('node:fs/promises');
      return {
        format: 'jpg',
        bytes: new Uint8Array(await readFile(path)),
        capturedAt: deps.now().toISOString(),
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  /** 絵から文字を読む（段 2・C55）。**道具が無ければ空**（黙って空にしない側は呼び出し元）。 */
  const readText = async (bytes: Uint8Array): Promise<string> => {
    if (deps.ocrPath === undefined) return '';
    const dir = await mkdtemp(join(tmpdir(), 'git-qa-ios-ocr-'));
    // **名前を中身に合わせる**（WDA の絵は PNG・USB の絵は JPEG）。
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const path = join(dir, isPng ? 'frame.png' : 'frame.jpg');
    try {
      await writeFile(path, bytes);
      return await runTool(deps.ocrPath, [path]);
    } catch {
      // **読めないことは、見られないことではない。**映像は出る。
      return '';
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  const liveView: LiveView = {
    get isOpen() {
      return liveOpen;
    },
    // **ウェブと同じ道に乗せる**（C54）。画面側は既に JPEG の並びを描ける。
    transport: { kind: 'image-frames', label: 'ios usb capture', mimeType: 'image/jpeg' },
    open() {
      ensureOpen();
      liveOpen = true;
      return Promise.resolve();
    },
    close() {
      liveOpen = false;
      streaming?.kill('SIGTERM');
      streaming = undefined;
      return Promise.resolve();
    },
    frames() {
      if (!liveOpen) {
        // 開く前に読もうとしている。**空を返すと「映像が来ない」に化ける。**
        throw new AdapterError(KIND, '映像を出す準備ができていない（ライブビューを開く前）');
      }
      const child = spawn(deps.toolPath, iosArgs.stream(deps.device.id), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      streaming = child;
      // **道具の言い分は捨てない。**映らない理由がここに出る。
      child.stderr?.on('data', (chunk: Buffer) => {
        process.stderr.write(`[git-qa-ios] ${chunk.toString()}`);
      });
      return framesFrom(child.stdout as AsyncIterable<Uint8Array>);
    },
  };

  /**
   * **アダプタは録らない**（ウェブと同じ）。
   *
   * 録るのは宿主で、**流れてくる絵から作る**（`frame-recording.ts`）。
   * ここは**持っていないと言う**（C20・できないことを `failed` にしない）。
   */
  const recording: RecordingControl = {
    requested: false,
    start: () => Promise.resolve(),
    stop: () =>
      Promise.resolve({
        state: 'unsupported' as const,
        reason: 'iOS の録画はアダプタ側では持っていない（流れてくる絵から宿主が作る）',
      }),
  };

  return {
    target: {
      kind: KIND,
      // **機種は残す。名前は残さない**（人が付けるので、個人名が入る・§25）。
      device: deps.device.model,
      build: deps.build,
      ...(deps.destination === undefined ? {} : { destination: deps.destination }),
    },
    liveView,
    recording,
    get isClosed() {
      return closed;
    },

    /**
     * **押す・打つは WebDriverAgent に頼む**（C99）。口が無ければ理由を言って止まる（C20）。
     * 押す口を持つまでは、ここで止めて planning を「人が操作する」に倒していた。
     */
    act(action: Action): Promise<ActReport> {
      ensureOpen();
      return iosAct(action, {
        wda,
        look: async () => readText((await shoot()).bytes),
      });
    },

    async observe(): Promise<Observation> {
      const shot = await shoot();
      const text = await readText(shot.bytes);
      return {
        kind: KIND,
        capturedAt: shot.capturedAt,
        // **絵から読んだ文字だけ。**AX 木は取れない（WebDriverAgent が要る）。
        raw: { screenText: text },
      };
    },

    screenshot: shoot,

    /**
     * **相手が入れ替わっていないかを測る**（#3）。
     *
     * **識別子そのものは残さない。**端末を特定できる値で、証跡は人に渡るもの（§25）。
     * **短く潰したものを残す** —— 入れ替わったかどうかは、これで分かる。
     *
     * **画面の中で何が動いたかは測れない**（端末側に口が無い）。
     */
    fingerprint: () => Promise.resolve(`${deps.device.model}\t${shortenId(deps.device.id)}`),

    async close(): Promise<void> {
      closed = true;
      await liveView.close();
    },
  };
}

/**
 * 画面の文字を読む（**判定はこれを見る**・C64）。
 *
 * **絵から読む道具（`git-qa-ocr`）だけが出どころ。**AX 木は取れない
 * （端末側に WebDriverAgent が要る）。**道具が無ければ空**で、
 * **空は「文字が無い」ではなく「読めない」**として扱われる（呼ぶ側が言う）。
 */
export async function readIosScreenText(session: TargetSession): Promise<string> {
  const seen = await session.observe();
  const raw = seen.raw;
  if (typeof raw !== 'object' || raw === null) return '';
  const said = (raw as { screenText?: unknown }).screenText;
  return typeof said === 'string' ? said : '';
}

/**
 * **押せる名前は並べられない**（2026-09-19）。
 *
 * iOS は**押す口をそもそも持っていない**（WebDriverAgent が要る）。
 * **空を返さない。**「無い」と「この相手では出来ない」を混ぜると、
 * AI は「画面に何も無い」と受け取る。
 */
export function listIosElements(): Promise<string[]> {
  return Promise.reject(
    new AdapterError(
      KIND,
      'iPhone / iPad では名前で押せない（押す口が無い）。' +
        '画面の絵と文字は取れるので、それを見て人に操作を頼んでください',
    ),
  );
}
