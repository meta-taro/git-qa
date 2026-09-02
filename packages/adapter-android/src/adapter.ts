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

import {
  findElementCenter,
  inputCommands,
  parseDeviceList,
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
    /** `h264-stream` のときの 1 回あたりの長さ。上限 180 秒。 */
    readonly timeLimitSec?: number;
  };
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
  let closed = false;

  const ensureOpen = (): void => {
    if (closed) throw new AdapterError(KIND, 'セッションは閉じられている');
  };

  const mode: LiveViewMode = options.liveView?.mode ?? 'external-window';
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
        liveStream = startScreenrecord();
        liveProcess = liveStream;
      } else {
        liveProcess = runner.start(scrcpy, ['-s', serial, '--window-title', `git-qa ${serial}`]);
      }
      return Promise.resolve();
    },

    async close() {
      const running = liveProcess;
      liveOpen = false;
      liveProcess = undefined;
      liveStream = undefined;
      await running?.stop();
    },

    ...(mode === 'h264-stream'
      ? {
          frames(): AsyncIterable<Uint8Array> {
            if (liveStream === undefined) {
              // 開く前に読もうとしている。空を返すと「映像が来ない」に化けるので落とす。
              throw new AdapterError(KIND, 'ライブビューを開く前に映像を読もうとしている');
            }
            return {
              /**
               * **`screenrecord` には 180 秒の上限がある。**尽きたら繋ぎ直す。
               * 人は窓を開けっぱなしにするので、切れたまま黙ると画面が固まったように見える
               * （実機で 3 時間半後に 0 バイトになった）。
               *
               * 繋ぎ直しの前後で数フレーム落ちる。**止まったまま黙るよりはよい。**
               */
              async *[Symbol.asyncIterator]() {
                while (liveOpen) {
                  const stream = liveStream ?? startScreenrecord();
                  liveStream = stream;
                  liveProcess = stream;

                  let seen = 0;
                  for await (const chunk of stream.chunks) {
                    seen += 1;
                    yield chunk;
                  }

                  // 尽きた。閉じられたのなら起こし直さない（端末を掴んだままにしない）。
                  if (!liveOpen) return;
                  if (seen === 0) {
                    // 1 枚も来ずに終わった。**繋ぎ直しを繰り返すと、黙ったまま回り続ける。**
                    throw new AdapterError(KIND, 'screenrecord が映像を 1 枚も返さずに終わった');
                  }
                  liveStream = undefined;
                }
              },
            };
          },
        }
      : {}),
  };

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

  const resolve = async (ref: PointerRef): Promise<Point> => {
    if (ref.at === 'point') return { x: ref.x, y: ref.y };
    const xml = await dumpHierarchy();
    const found = findElementCenter(xml, ref.ref);
    if (found === undefined) {
      throw new AdapterError(KIND, `画面に見つからない要素: ${JSON.stringify(ref.ref)}`);
    }
    return found;
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
      for (const args of inputCommands(await resolveAction(action))) {
        await adbRun(args, serial);
      }
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
