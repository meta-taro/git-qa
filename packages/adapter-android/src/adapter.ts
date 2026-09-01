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
  withSerial,
  type Point,
  type ResolvedAction,
} from './adb.js';
import type { CommandRunner, RunningProcess } from './command.js';
import { createNodeCommandRunner } from './node-runner.js';

const KIND = 'android';
const DUMP_PATH = '/sdcard/git-qa-window-dump.xml';
const DEFAULT_SWIPE_MS = 300;

export interface AndroidAdapterOptions {
  /** 検証している対象アプリ。**端末の情報ではない**ので、こちらから渡してもらう。 */
  readonly build: TargetBuild;
  /** 繋ぐ端末。省略すると `adb devices` で 1 台に決まるときだけ繋ぐ。 */
  readonly serial?: string;
  readonly adbPath?: string;
  readonly scrcpyPath?: string;
  /** 録画するかは実行開始時の設定（C11）。保管先も一緒に受ける。 */
  readonly recording?: { readonly requested: boolean; readonly runsDir: string };
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

      return createSession({ target, serial, adbRun, runner, scrcpy, now, options });
    },
  };
}

interface SessionDeps {
  readonly target: Target;
  readonly serial: string;
  readonly adbRun: (args: readonly string[], serial?: string) => Promise<Uint8Array>;
  readonly runner: CommandRunner;
  readonly scrcpy: string;
  readonly now: () => Date;
  readonly options: AndroidAdapterOptions;
}

function createSession(deps: SessionDeps): TargetSession {
  const { target, serial, adbRun, runner, scrcpy, now, options } = deps;
  let closed = false;

  const ensureOpen = (): void => {
    if (closed) throw new AdapterError(KIND, 'セッションは閉じられている');
  };

  let liveProcess: RunningProcess | undefined;
  const liveView: LiveView = {
    get isOpen() {
      return liveProcess !== undefined;
    },
    transport: { kind: 'external-window', label: `scrcpy ${serial}` },
    open(): Promise<void> {
      ensureOpen();
      // 二重に開いても落ちない（契約テスト）。既に出ているなら何もしない。
      if (liveProcess === undefined) {
        liveProcess = runner.start(scrcpy, ['-s', serial, '--window-title', `git-qa ${serial}`]);
      }
      return Promise.resolve();
    },
    async close() {
      const running = liveProcess;
      liveProcess = undefined;
      await running?.stop();
    },
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
