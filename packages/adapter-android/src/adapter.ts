import { join } from 'node:path';

import { AdapterError, caseDirName } from '@git-qa/core';
import type {
  Action,
  AdapterCapabilities,
  CaseRecording,
  LiveView,
  Observation,
  PointerRef,
  RecordingControl,
  Screenshot,
  Target,
  TargetAdapter,
  TargetBuild,
  TargetSession,
} from '@git-qa/core';

import type { AdbDevice } from './adb.js';
import {
  findElementCenter,
  inputCommands,
  parseDeviceList,
  parseResolvedActivity,
  parseScreenSize,
  parseWakefulness,
  screenText,
  withSerial,
  type Point,
  type ResolvedAction,
} from './adb.js';
import type { CommandRunner, RunningProcess, StreamingProcess } from './command.js';
import { createNodeCommandRunner } from './node-runner.js';

const KIND = 'android';
const DUMP_PATH = '/sdcard/git-qa-window-dump.xml';
const DEFAULT_SWIPE_MS = 300;
/** 押してから画面が変わるまで。実機・エミュレータで測って決めた（2026-09-04）。 */
const DEFAULT_SETTLE_MS = 500;
/** 要素が出てくるのを待つ上限。これを超えたら「見つからない」と言う。 */
const DEFAULT_FIND_TIMEOUT_MS = 3000;
/** `screenrecord` の上限。これより長くは指定できないので、超える運用では繋ぎ直す。 */
const SCREENRECORD_MAX_SEC = 180;

/**
 * ライブ映像の出し方。
 *
 * - `external-window` — scrcpy の窓を別に出す。**人が 2 つの窓を見比べることになる**
 * - `h264-stream` — `adb exec-out screenrecord` の生 H.264 を流す。**枠の中に描ける**（C27 の方式 A）
 *
 * どちらを既定にするかは D6（`docs/adr/0003-live-view-transport.md`）で保留中。
 * **いまは呼ぶ側が選ぶ。**遅延を実測してから決める。
 */
export type LiveViewMode = 'external-window' | 'h264-stream';

export interface AndroidAdapterOptions {
  /** 検証している対象アプリ。**端末の情報ではない**ので、こちらから渡してもらう。 */
  readonly build: TargetBuild;
  /** 繋ぐ端末。省略すると `adb devices` で 1 台に決まるときだけ繋ぐ。 */
  readonly serial?: string;
  readonly adbPath?: string;
  readonly scrcpyPath?: string;
  /** 録画するかは実行開始時の設定（C11）。保管先も一緒に受ける。 */
  readonly recording?: { readonly requested: boolean; readonly runsDir: string };
  /** ライブ映像の出し方。既定は別窓（従来どおり）。 */
  readonly liveView?: {
    readonly mode?: LiveViewMode;
    /** `h264-stream` のときの大きさ（`720x1480` の形）。**小さいほど遅れが減る。** */
    readonly size?: string;
    /** `h264-stream` のときのビットレート（bps）。**落とすほど遅れが減る。** */
    readonly bitRate?: number;
    /** `h264-stream` のときの 1 回あたりの長さ。上限 180 秒。 */
    readonly timeLimitSec?: number;
  };
  /**
   * 画面が落ち着くのを待つ時間（ms）。**押した直後の画面は、まだ前の画面。**
   * 送った文字が行き先を失って黙って捨てられるので、次の操作との間に挟む。
   */
  readonly settleMs?: number;
  /** 要素が出てくるのを待つ上限（ms）。**待っても出てこなければ、見つからないと言う。** */
  readonly findTimeoutMs?: number;
  /** 差し替え口。既定は本物のプロセス。テストでは待たない。 */
  readonly sleep?: (ms: number) => Promise<void>;
  /** 差し替え口。既定は本物のプロセス。 */
  readonly runner?: CommandRunner;
  readonly now?: () => Date;
}

export function createAndroidAdapter(options: AndroidAdapterOptions): TargetAdapter {
  const runner = options.runner ?? createNodeCommandRunner();
  const adb = options.adbPath ?? 'adb';
  const scrcpy = options.scrcpyPath ?? 'scrcpy';
  const now = options.now ?? (() => new Date());

  const capabilities: AdapterCapabilities = {
    // Android の画面の状態は uiautomator のツリー。DOM とは別物なので潰さない（C24）。
    observation: 'accessibility-tree',
    recording: true,
  };

  const adbRun = async (args: readonly string[], serial?: string): Promise<Uint8Array> => {
    const result = await runner.run(adb, withSerial(serial, args));
    if (result.code !== 0) {
      throw new AdapterError(KIND, `adb ${args.join(' ')} が失敗した: ${result.stderr.trim()}`);
    }
    return result.stdout;
  };

  const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

  return {
    kind: KIND,
    capabilities,

    async connect(): Promise<TargetSession> {
      const listed = parseDeviceList(text(await adbRun(['devices'])));
      const usable = listed.filter((d) => d.state === 'device');

      const serial = options.serial ?? usable[0]?.serial;
      if (serial === undefined) {
        // 何が見えているかを添える。「繋がらない」だけだと、電源なのか許可待ちなのか分からない。
        const seen =
          listed.length === 0
            ? '1 台も見えていない'
            : listed.map((d) => `${d.serial}=${d.state}`).join(', ');
        throw new AdapterError(KIND, `繋げる端末が無い（${seen}）`);
      }
      if (options.serial === undefined && usable.length > 1) {
        throw new AdapterError(
          KIND,
          `端末が ${usable.length} 台見えている。serial で指定すること（${usable.map((d) => d.serial).join(', ')}）`,
        );
      }

      const prop = async (name: string): Promise<string> =>
        text(await adbRun(['shell', 'getprop', name], serial)).trim();

      const target: Target = {
        kind: KIND,
        device: (await prop('ro.product.model')) || serial,
        osVersion: await prop('ro.build.version.release'),
        build: options.build,
      };

      return createSession({ target, serial, adb, adbRun, runner, scrcpy, now, options });
    },
  };
}

interface SessionDeps {
  readonly target: Target;
  readonly serial: string;
  /** adb の実行ファイル。映像を流すときは adbRun を通さず直接起動する。 */
  readonly adb: string;
  readonly adbRun: (args: readonly string[], serial?: string) => Promise<Uint8Array>;
  readonly runner: CommandRunner;
  readonly scrcpy: string;
  readonly now: () => Date;
  readonly options: AndroidAdapterOptions;
}

function createSession(deps: SessionDeps): TargetSession {
  const { target, serial, adb, adbRun, runner, scrcpy, now, options } = deps;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const findTimeoutMs = options.findTimeoutMs ?? DEFAULT_FIND_TIMEOUT_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let closed = false;

  const ensureOpen = (): void => {
    if (closed) throw new AdapterError(KIND, 'セッションは閉じられている');
  };

  const mode: LiveViewMode = options.liveView?.mode ?? 'external-window';
  /** ライブビューの大きさ。端末の実寸ではなく、人が判断できる大きさで足りる。 */
  const liveSize = options.liveView?.size ?? '720x1480';
  /** 1 秒あたりの符号化量。落とすほど遅れが減る。 */
  const liveBitRate = options.liveView?.bitRate ?? 4_000_000;

  const timeLimitSec = Math.min(
    options.liveView?.timeLimitSec ?? SCREENRECORD_MAX_SEC,
    SCREENRECORD_MAX_SEC,
  );

  let liveProcess: RunningProcess | undefined;
  let liveStream: StreamingProcess | undefined;
  /** 開いている間だけ繋ぎ直す。閉じた後に起こさないための印。 */
  let liveOpen = false;

  /** `screenrecord` を 1 本起こす。**端末に何も送り込まない**（Android 標準のものを使う）。 */
  const startScreenrecord = (): StreamingProcess =>
    runner.stream(adb, [
      ...withSerial(serial, [
        'exec-out',
        'screenrecord',
        '--output-format=h264',
        `--time-limit=${String(timeLimitSec)}`,
        // **人が見て判断できる大きさで足りる。**大きいほど符号化と転送に時間がかかり、
        // 操作から画面に出るまでが延びる（Issue 005）。
        '--size',
        liveSize,
        '--bit-rate',
        String(liveBitRate),
        '-',
      ]),
    ]);

  const liveView: LiveView = {
    get isOpen() {
      return liveProcess !== undefined;
    },
    transport:
      mode === 'h264-stream'
        ? { kind: 'h264-stream', label: `screenrecord ${serial}` }
        : { kind: 'external-window', label: `scrcpy ${serial}` },

    open(): Promise<void> {
      ensureOpen();
      // 二重に開いても落ちない（契約テスト）。既に出ているなら何もしない。
      if (liveProcess !== undefined) return Promise.resolve();

      liveOpen = true;
      if (mode === 'h264-stream') {
        // **ここでは端末を触らない。**読み手が繋いだ時点で `frames()` が起こす。
        // 開いた時点で 1 本起こすと、誰も見ていない間も端末が録り続け、
        // **読み手が入れ替わったときに 2 人目が受け取れない**（実機で真っ黒になった）。
      } else {
        liveProcess = runner.start(scrcpy, ['-s', serial, '--window-title', `git-qa ${serial}`]);
      }
      return Promise.resolve();
    },

    async close() {
      const running = liveProcess;
      const streaming = liveStream;
      liveOpen = false;
      liveProcess = undefined;
      liveStream = undefined;
      // 読み手がまだ回している最中でも、端末側は止める。
      await streaming?.stop();
      await running?.stop();
    },

    ...(mode === 'h264-stream'
      ? {
          frames(): AsyncIterable<Uint8Array> {
            if (!liveOpen) {
              // 開く前に読もうとしている。空を返すと「映像が来ない」に化けるので落とす。
              throw new AdapterError(KIND, 'ライブビューを開く前に映像を読もうとしている');
            }
            return {
              /**
               * **読み手 1 人につき 1 本**の `screenrecord` を持つ。
               *
               * 画面を読み込み直すと橋へ繋ぎ直しに来る（vite の再読み込み・webview の復帰）。
               * 1 本を共有すると、**2 人目が何も受け取れず真っ黒になる**（実機で起きた）。
               *
               * `screenrecord` には 180 秒の上限があるので、尽きたら繋ぎ直す。
               * 人は窓を開けっぱなしにするので、切れたまま黙ると画面が固まったように見える。
               */
              async *[Symbol.asyncIterator]() {
                let current: StreamingProcess | undefined;
                try {
                  while (liveOpen) {
                    // **端末では screenrecord が同時に 1 本しか成立しない。**
                    // 2 本目は何も返さずに終わり、画面は真っ黒になる（実機で起きた）。
                    // いま動いている 1 本を必ず止めてから起こす。読み手が入れ替わったとき
                    // （画面の読み込み直し）は、古い読み手のほうが切れる。
                    await liveStream?.stop();
                    await current?.stop();
                    current = startScreenrecord();
                    liveStream = current;

                    let seen = 0;
                    for await (const chunk of current.chunks) {
                      seen += 1;
                      yield chunk;
                    }

                    // 尽きた。閉じられたのなら起こし直さない（端末を掴んだままにしない）。
                    if (!liveOpen) return;
                    if (seen === 0) {
                      // 1 枚も来ずに終わった。**繋ぎ直しを繰り返すと、黙ったまま回り続ける。**
                      // **まず画面の状態を見る。**消えていれば、それが理由（実機で踏んだ）。
                      const power = await adbRun(['shell', 'dumpsys', 'power'], serial).catch(
                        () => new Uint8Array(),
                      );
                      if (parseWakefulness(new TextDecoder().decode(power)) === 'asleep') {
                        throw new AdapterError(
                          KIND,
                          '端末の画面が消えている。点けてから繋ぎ直すこと',
                        );
                      }
                      throw new AdapterError(KIND, 'screenrecord が映像を 1 枚も返さずに終わった');
                    }
                  }
                } finally {
                  // **読み手が去ったら端末側も止める。**残すと screenrecord が溜まる。
                  await current?.stop();
                  if (liveStream === current) liveStream = undefined;
                }
              },
            };
          },
        }
      : {}),
  };

  /** 端末の実寸。読み直しが要らないので覚えておく。 */
  let cachedScreen: { width: number; height: number } | undefined;

  let recProcess: RunningProcess | undefined;
  let recFile: string | undefined;
  let recStartedAt: number | undefined;
  const requested = options.recording?.requested ?? false;

  const recording: RecordingControl = {
    requested,
    start(caseNo): Promise<void> {
      ensureOpen();
      if (!requested || options.recording === undefined) return Promise.resolve();
      const file = join(options.recording.runsDir, caseDirName(caseNo), 'screen.mp4');
      // ライブビューとは別プロセスにする。人が窓を閉じても録画は続くべきで、逆も同じ。
      recProcess = runner.start(scrcpy, [
        '-s',
        serial,
        '--no-window',
        '--no-audio',
        '--no-control',
        `--record=${file}`,
      ]);
      recFile = file;
      recStartedAt = now().getTime();
      return Promise.resolve();
    },
    async stop(): Promise<CaseRecording> {
      if (!requested) return { state: 'not_requested' };
      const process = recProcess;
      const file = recFile;
      const startedAt = recStartedAt;
      recProcess = undefined;
      recFile = undefined;
      recStartedAt = undefined;
      if (process === undefined || file === undefined || startedAt === undefined) {
        // 録画すると言われたのに始まっていない。黙って not_requested にすると、
        // 「録画オフで走らせた」と区別が付かなくなる（C20）。
        return { state: 'failed', reason: '録画が開始されていない' };
      }
      await process.stop();
      return { state: 'recorded', file, durationMs: now().getTime() - startedAt };
    },
  };

  /**
   * 要素の位置を出す。**すぐに見つからなくても、少し待って探し直す。**
   * 画面の切り替えは一瞬では終わらないので、1 回見て無いことを「無い」にしない。
   * ただし待つのは上限まで。**待ち続けて通ったことにはしない。**
   */
  const resolve = async (ref: PointerRef): Promise<Point> => {
    if (ref.at === 'point') return { x: ref.x, y: ref.y };
    // 待つ長さではなく**回数**で切る。証跡用の `now` は止めてあることがあり、
    // 時計で切ると止まらなくなる（実際にテストが無限に回った）。
    const attempts = Math.max(1, Math.ceil(findTimeoutMs / Math.max(1, settleMs)));
    for (let i = 0; i < attempts; i += 1) {
      const found = findElementCenter(await dumpHierarchy(), ref.ref);
      if (found !== undefined) return found;
      if (i + 1 < attempts) await sleep(settleMs);
    }
    throw new AdapterError(KIND, `画面に見つからない要素: ${JSON.stringify(ref.ref)}`);
  };

  /**
   * 起動先を端末に聞く。**入っていなければ触らずに落とす。**
   * `monkey` は無いパッケージでも終了コード 0 を返すので、在否はここで確かめる。
   */
  const resolveLaunch = async (app: string): Promise<string> => {
    const stdout = await adbRun(
      ['shell', 'cmd', 'package', 'resolve-activity', '--brief', app],
      serial,
    );
    const component = parseResolvedActivity(new TextDecoder().decode(stdout));
    if (component === undefined) {
      throw new AdapterError(KIND, `端末に入っていないか、起動できないアプリ: ${app}`);
    }
    return component;
  };

  /**
   * 送った文字が入ったことを確かめる。**入っていなければ、もう一度送る。**
   *
   * 画面が切り替わった直後は、入力先がまだ受け取れる状態になっていない。
   * 実測（エミュレータ・2026-09-04）では 0.5 秒待っても入らず、1.0 秒で入った。
   * **待つ長さを決め打ちにすると、端末が変わった瞬間に破れる**ので、結果を見て決める。
   *
   * 送り直すのは文字だけ・**1 回だけ**（前の tap は繰り返さない。押し直すと入力位置が動く）。
   * **入らないまま終わっても落とさない。**伏せ字の欄のように、入れても画面に出ない欄がある。
   * 入ったかどうかは、このあと期待結果を見るところで判断される。
   */
  const ensureTyped = async (text: string, textCommand: readonly string[]): Promise<void> => {
    if (screenText(await dumpHierarchy()).includes(text)) return;
    // **送り直すのは 1 回だけ。**入れても画面に出ない欄（伏せ字）で繰り返すと、
    // 見えないまま何度も打ち込むことになる。
    await adbRun(textCommand, serial);
    await sleep(settleMs);
  };

  const dumpHierarchy = async (): Promise<string> => {
    await adbRun(['shell', 'uiautomator', 'dump', DUMP_PATH], serial);
    return new TextDecoder().decode(await adbRun(['shell', 'cat', DUMP_PATH], serial));
  };

  const resolveAction = async (action: Action): Promise<ResolvedAction> => {
    switch (action.kind) {
      case 'tap':
        return { kind: 'tap', at: await resolve(action.target) };
      case 'swipe':
        return {
          kind: 'swipe',
          from: await resolve(action.from),
          to: await resolve(action.to),
          durationMs: action.durationMs ?? DEFAULT_SWIPE_MS,
        };
      case 'type':
        return action.target === undefined
          ? { kind: 'type', text: action.text }
          : { kind: 'type', text: action.text, at: await resolve(action.target) };
      case 'key':
        return { kind: 'key', key: action.key };
      case 'launch':
        return { kind: 'launch', component: await resolveLaunch(action.app) };
    }
  };

  return {
    target,
    liveView,
    recording,
    get isClosed() {
      return closed;
    },

    async act(action) {
      ensureOpen();
      const resolved = await resolveAction(action);
      const commands = inputCommands(resolved);
      for (const args of commands) {
        await adbRun(args, serial);
      }
      // 押した直後の画面は、まだ前の画面。**次の操作を送る前に落ち着かせる。**
      await sleep(settleMs);
      if (resolved.kind === 'type' && resolved.text !== '') {
        await ensureTyped(resolved.text, commands.at(-1) ?? []);
      }
    },

    /**
     * 端末の画面の実寸。**映像を縮めて流しているので、人が触った座標を戻すのに要る。**
     * 一度読んだら覚えておく（回転しない前提。回るなら読み直しが要る）。
     */
    async screenSize(): Promise<{ width: number; height: number }> {
      ensureOpen();
      if (cachedScreen !== undefined) return cachedScreen;
      const stdout = await adbRun(['shell', 'wm', 'size'], serial);
      const size = parseScreenSize(new TextDecoder().decode(stdout));
      if (size === undefined) {
        // 握り潰さない。**勝手な既定を返すと、見当違いの所を触る。**
        throw new AdapterError(
          KIND,
          `端末の画面の大きさを読めない: ${new TextDecoder().decode(stdout)}`,
        );
      }
      cachedScreen = { width: size.x, height: size.y };
      return cachedScreen;
    },

    async observe(): Promise<Observation> {
      ensureOpen();
      // 生のまま返す。コアは解釈しない（C24）。
      return { kind: KIND, capturedAt: now().toISOString(), raw: await dumpHierarchy() };
    },

    async screenshot(): Promise<Screenshot> {
      ensureOpen();
      const bytes = await adbRun(['exec-out', 'screencap', '-p'], serial);
      if (bytes.byteLength === 0) {
        throw new AdapterError(KIND, 'screencap が空を返した');
      }
      return { format: 'png', bytes, capturedAt: now().toISOString() };
    },

    async close() {
      if (closed) return;
      closed = true;
      await liveView.close();
      await recProcess?.stop();
      recProcess = undefined;
    },
  };
}

/**
 * 繋いだセッションから、**画面で読める文字**を取る。
 *
 * 期待結果（「〜と表示される」）との突き合わせに使う（`createSheetCaseRunner`）。
 * **生データの形を知っているのはアダプタだけ**なので、ここに置く（コアは解釈しない・C8）。
 */
export async function readAndroidScreenText(session: TargetSession): Promise<string> {
  const observation = await session.observe();
  if (typeof observation.raw !== 'string') {
    // 握り潰さない。読めないまま空文字を返すと、期待結果が「無い」ことになり FAIL が積む。
    throw new Error('画面の生データが uiautomator の XML ではない');
  }
  return screenText(observation.raw);
}

export interface ListAndroidDevicesOptions {
  readonly runner?: CommandRunner;
  readonly adb?: string;
}

/**
 * 繋がっている端末を並べる。
 *
 * **アプリを入口にするために要る**（Issue 011 段階 3）。いまはターミナルで `adb devices` を
 * 打つしかなく、人が端末を選べない。
 *
 * **1 台も見えなくても落とさない。**選ぶ前の画面で落とすと、人は次に何をすればよいか
 * 分からなくなる（「繋いでください」と出すのは画面側の仕事）。
 */
export async function listAndroidDevices(
  options: ListAndroidDevicesOptions = {},
): Promise<AdbDevice[]> {
  const runner = options.runner ?? createNodeCommandRunner();
  const adb = options.adb ?? 'adb';
  // `-l` は付けない。要るのは serial と状態だけで、増やすと読む所も増える。
  const result = await runner.run(adb, ['devices']);
  return parseDeviceList(new TextDecoder().decode(result.stdout));
}
