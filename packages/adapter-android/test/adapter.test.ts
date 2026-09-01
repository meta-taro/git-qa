import { describe, expect, it } from 'vitest';

import { describeAdapterContract } from '@git-qa/core/testing';
import type { TargetAdapter } from '@git-qa/core';

import { createAndroidAdapter } from '../src/index.js';
import type {
  CommandResult,
  CommandRunner,
  RunningProcess,
  StreamingProcess,
} from '../src/index.js';

const DUMP = `<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0">
  <node index="0" text="保存" resource-id="com.example:id/save" content-desc="" bounds="[100,200][300,280]" />
</hierarchy>`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Recorded {
  readonly ran: string[][];
  readonly started: string[][];
  readonly streamed: string[][];
  readonly processes: FakeProcess[];
  /** `stream()` が流すもの。テストごとに差し替える。 */
  chunks: Uint8Array[];
}

class FakeProcess implements RunningProcess {
  isRunning = true;
  stop(): Promise<void> {
    this.isRunning = false;
    return Promise.resolve();
  }
}

/**
 * adb / scrcpy の代わり。**端末が無くても契約テストを当てられるようにするためのもの**
 * （product-baseline §4「繋がらない環境でも走る形にする」）。
 */
function fakeRunner(overrides: Record<string, CommandResult> = {}): CommandRunner & Recorded {
  const ran: string[][] = [];
  const started: string[][] = [];
  const streamed: string[][] = [];
  const processes: FakeProcess[] = [];
  const state = { chunks: [] as Uint8Array[] };

  const ok = (stdout: string | Uint8Array = ''): CommandResult => ({
    code: 0,
    stdout: typeof stdout === 'string' ? new TextEncoder().encode(stdout) : stdout,
    stderr: '',
  });

  const defaults: Record<string, CommandResult> = {
    devices: ok('List of devices attached\nemulator-5554\tdevice\n'),
    'shell getprop ro.product.model': ok('sdk_gphone64_arm64\n'),
    'shell getprop ro.build.version.release': ok('12\n'),
    'exec-out screencap -p': ok(PNG),
    'shell cat /sdcard/git-qa-window-dump.xml': ok(DUMP),
  };

  return {
    ran,
    started,
    streamed,
    processes,
    get chunks() {
      return state.chunks;
    },
    set chunks(value: Uint8Array[]) {
      state.chunks = value;
    },
    run(_command, args) {
      ran.push([...args]);
      // -s <serial> は呼び分けの本質ではないので、突き合わせる前に落とす。
      const key = [...args].slice(args[0] === '-s' ? 2 : 0).join(' ');
      return Promise.resolve(overrides[key] ?? defaults[key] ?? ok());
    },
    start(_command, args) {
      started.push([...args]);
      const p = new FakeProcess();
      processes.push(p);
      return p;
    },
    stream(_command, args): StreamingProcess {
      streamed.push([...args]);
      const p = new FakeProcess();
      processes.push(p);
      const queued = state.chunks;
      return Object.assign(p, {
        chunks: {
          // eslint-disable-next-line @typescript-eslint/require-await -- 非同期の口に同期の中身を流す
          async *[Symbol.asyncIterator]() {
            for (const c of queued) yield c;
          },
        },
      });
    },
  };
}

const build = { source: 'example/sample-notes-app', label: 'debug' };

const makeAdapter = (): TargetAdapter =>
  createAndroidAdapter({
    build,
    runner: fakeRunner(),
    now: () => new Date('2026-09-02T00:00:00Z'),
  });

// 実装ごとに当てる束（Issue 002）。ここが通ることが答え合わせになる。
describeAdapterContract('Android（adb / scrcpy を差し替えたもの）', makeAdapter);

describe('接続', () => {
  it('端末の型番と OS の版を target に入れる', async () => {
    const session = await makeAdapter().connect();
    expect(session.target).toEqual({
      kind: 'android',
      device: 'sdk_gphone64_arm64',
      osVersion: '12',
      build,
    });
  });

  it('型番が取れないときは serial で代用する', async () => {
    const runner = fakeRunner({
      'shell getprop ro.product.model': { code: 0, stdout: new Uint8Array(), stderr: '' },
    });
    const session = await createAndroidAdapter({ build, runner }).connect();
    expect(session.target.kind === 'android' && session.target.device).toBe('emulator-5554');
  });

  it('端末が 1 台も無いときは、何が見えていたかを添えて落ちる', async () => {
    const runner = fakeRunner({
      devices: {
        code: 0,
        stdout: new TextEncoder().encode('List of devices attached\n'),
        stderr: '',
      },
    });
    await expect(createAndroidAdapter({ build, runner }).connect()).rejects.toThrow(
      /1 台も見えていない/,
    );
  });

  it('繋げない状態の端末しか無いときは、その状態を添えて落ちる', async () => {
    const runner = fakeRunner({
      devices: {
        code: 0,
        stdout: new TextEncoder().encode('List of devices attached\nR3C\tunauthorized\n'),
        stderr: '',
      },
    });
    await expect(createAndroidAdapter({ build, runner }).connect()).rejects.toThrow(
      /R3C=unauthorized/,
    );
  });

  it('端末が複数見えていて serial の指定が無ければ、選ばずに落ちる', async () => {
    // 黙って 1 台目を選ぶと、証跡に書いた相手と実際に触った相手がずれる。
    const runner = fakeRunner({
      devices: {
        code: 0,
        stdout: new TextEncoder().encode('List of devices attached\nA\tdevice\nB\tdevice\n'),
        stderr: '',
      },
    });
    await expect(createAndroidAdapter({ build, runner }).connect()).rejects.toThrow(
      /2 台見えている/,
    );
  });

  it('serial を指定すれば、複数見えていても繋ぐ', async () => {
    const runner = fakeRunner({
      devices: {
        code: 0,
        stdout: new TextEncoder().encode('List of devices attached\nA\tdevice\nB\tdevice\n'),
        stderr: '',
      },
    });
    const session = await createAndroidAdapter({ build, runner, serial: 'B' }).connect();
    expect(session.target.kind).toBe('android');
    expect(runner.ran.some((a) => a[0] === '-s' && a[1] === 'B')).toBe(true);
  });

  it('adb が失敗したら握り潰さずに落ちる', async () => {
    const runner = fakeRunner({
      devices: { code: 1, stdout: new Uint8Array(), stderr: 'adb: no permissions' },
    });
    await expect(createAndroidAdapter({ build, runner }).connect()).rejects.toThrow(
      /no permissions/,
    );
  });
});

describe('操作', () => {
  it('座標のタップをそのまま渡す', async () => {
    const runner = fakeRunner();
    const session = await createAndroidAdapter({ build, runner }).connect();
    await session.act({ kind: 'tap', target: { at: 'point', x: 12, y: 34 } });
    expect(runner.ran.at(-1)?.slice(-4)).toEqual(['input', 'tap', '12', '34']);
  });

  it('要素の参照は、画面を読んで座標へ解決してから叩く', async () => {
    const runner = fakeRunner();
    const session = await createAndroidAdapter({ build, runner }).connect();
    await session.act({ kind: 'tap', target: { at: 'element', ref: 'com.example:id/save' } });
    expect(runner.ran.at(-1)?.slice(-4)).toEqual(['input', 'tap', '200', '240']);
  });

  it('画面に無い要素を指したら、握り潰さずに落ちる', async () => {
    const session = await makeAdapter().connect();
    await expect(
      session.act({ kind: 'tap', target: { at: 'element', ref: 'com.example:id/nope' } }),
    ).rejects.toThrow(/見つからない要素/);
  });

  it('swipe の所要時間を省くと既定値になる', async () => {
    const runner = fakeRunner();
    const session = await createAndroidAdapter({ build, runner }).connect();
    await session.act({
      kind: 'swipe',
      from: { at: 'point', x: 1, y: 2 },
      to: { at: 'point', x: 3, y: 4 },
    });
    expect(runner.ran.at(-1)?.at(-1)).toBe('300');
  });
});

describe('画面の状態', () => {
  it('uiautomator の出力を、解釈せず生のまま返す', async () => {
    const session = await makeAdapter().connect();
    const observation = await session.observe();
    expect(observation.kind).toBe('android');
    expect(observation.raw).toBe(DUMP);
  });

  it('screencap が空を返したら落ちる', async () => {
    // 空の PNG を証跡として残すと、後から「撮れていた」と誤読される。
    const runner = fakeRunner({
      'exec-out screencap -p': { code: 0, stdout: new Uint8Array(), stderr: '' },
    });
    const session = await createAndroidAdapter({ build, runner }).connect();
    await expect(session.screenshot()).rejects.toThrow(/screencap が空/);
  });
});

describe('ライブビュー', () => {
  it('開くと scrcpy が起動し、閉じると止まる', async () => {
    const runner = fakeRunner();
    const session = await createAndroidAdapter({ build, runner }).connect();
    await session.liveView.open();
    expect(runner.started).toHaveLength(1);
    expect(runner.processes[0]?.isRunning).toBe(true);
    await session.liveView.close();
    expect(runner.processes[0]?.isRunning).toBe(false);
  });

  it('二重に開いても scrcpy は 1 つ', async () => {
    const runner = fakeRunner();
    const session = await createAndroidAdapter({ build, runner }).connect();
    await session.liveView.open();
    await session.liveView.open();
    expect(runner.started).toHaveLength(1);
  });

  it('セッションを閉じるとライブビューも止まる', async () => {
    const runner = fakeRunner();
    const session = await createAndroidAdapter({ build, runner }).connect();
    await session.liveView.open();
    await session.close();
    expect(runner.processes[0]?.isRunning).toBe(false);
    expect(session.liveView.isOpen).toBe(false);
  });
});

describe('ライブビュー（生 H.264 を流す方式）', () => {
  const streaming = (runner: CommandRunner) =>
    createAndroidAdapter({ build, runner, liveView: { mode: 'h264-stream' } });

  it('transport が h264-stream になる', async () => {
    // 受け手は transport の種類を見て、枠の中に描くか別窓かを決める。
    const session = await streaming(fakeRunner()).connect();
    expect(session.liveView.transport.kind).toBe('h264-stream');
  });

  it('端末に何も送り込まず、screenrecord の生 H.264 を流す', async () => {
    const runner = fakeRunner();
    const session = await streaming(runner).connect();
    await session.liveView.open();

    expect(runner.streamed.at(-1)).toEqual([
      '-s',
      'emulator-5554',
      'exec-out',
      'screenrecord',
      '--output-format=h264',
      '--time-limit=180',
      '-',
    ]);
    // scrcpy は起動しない。
    expect(runner.started).toHaveLength(0);
  });

  it('1 回の長さは 180 秒を超えられない', async () => {
    // screenrecord 側の上限。超える値を渡されたら黙って丸める。
    const runner = fakeRunner();
    const session = await createAndroidAdapter({
      build,
      runner,
      liveView: { mode: 'h264-stream', timeLimitSec: 600 },
    }).connect();
    await session.liveView.open();

    expect(runner.streamed.at(-1)).toContain('--time-limit=180');
  });

  it('流れてきたものを、そのまま読める', async () => {
    const runner = fakeRunner();
    runner.chunks = [new Uint8Array([0, 0, 1, 0x67]), new Uint8Array([0, 0, 1, 0x65])];
    const session = await streaming(runner).connect();
    await session.liveView.open();

    const got: Uint8Array[] = [];
    for await (const chunk of session.liveView.frames?.() ?? []) got.push(chunk);
    expect(got).toEqual(runner.chunks);
  });

  it('開く前に読もうとしたら、空を返さずに落ちる', async () => {
    // 空を返すと「映像が来ない」に化けて、原因が分からなくなる。
    const session = await streaming(fakeRunner()).connect();
    expect(() => session.liveView.frames?.()).toThrow(/開く前に/);
  });

  it('別窓の方式では、映像を読む口を持たない', async () => {
    // 持たせると、別窓なのに映像が来ないのか、来ないだけなのかが区別できない。
    const session = await makeAdapter().connect();
    expect(session.liveView.transport.kind).toBe('external-window');
    // 口そのものが生えていないこと（undefined を返す口がある、ではない）。
    expect('frames' in session.liveView).toBe(false);
  });

  it('閉じると screenrecord も止まる', async () => {
    const runner = fakeRunner();
    const session = await streaming(runner).connect();
    await session.liveView.open();
    await session.liveView.close();

    expect(runner.processes.at(-1)?.isRunning).toBe(false);
  });
});

describe('録画', () => {
  const withRecording = (runner: CommandRunner, times: string[]) => {
    let i = 0;
    return createAndroidAdapter({
      build,
      runner,
      recording: { requested: true, runsDir: 'runs/20260902-000000' },
      now: () => new Date(times[Math.min(i++, times.length - 1)] ?? times[0] ?? ''),
    });
  };

  it('録画しない設定なら not_requested を返す（録画失敗と区別できる）', async () => {
    const session = await makeAdapter().connect();
    await session.recording.start(1);
    expect(await session.recording.stop()).toEqual({ state: 'not_requested' });
  });

  it('録画するとケースごとのディレクトリへ出し、長さを返す', async () => {
    const runner = fakeRunner();
    const session = await withRecording(runner, [
      '2026-09-02T00:00:00Z',
      '2026-09-02T00:00:05Z',
    ]).connect();
    await session.recording.start(3);
    const result = await session.recording.stop();
    expect(result).toEqual({
      state: 'recorded',
      file: 'runs/20260902-000000/case-003/screen.mp4',
      durationMs: 5000,
    });
    expect(runner.started.at(-1)?.some((a) => a.startsWith('--record='))).toBe(true);
  });

  it('録画すると言われたのに始まっていなければ failed を返す', async () => {
    // 黙って not_requested にすると「録画オフで走らせた」と区別が付かなくなる（C20）。
    const session = await withRecording(fakeRunner(), ['2026-09-02T00:00:00Z']).connect();
    expect(await session.recording.stop()).toEqual({
      state: 'failed',
      reason: '録画が開始されていない',
    });
  });

  it('ライブビューと録画は別のプロセスにする', async () => {
    // 人が窓を閉じても録画は続くべきで、逆も同じ。
    const runner = fakeRunner();
    const session = await withRecording(runner, ['2026-09-02T00:00:00Z']).connect();
    await session.liveView.open();
    await session.recording.start(1);
    expect(runner.started).toHaveLength(2);
    await session.liveView.close();
    expect(runner.processes[1]?.isRunning).toBe(true);
  });
});
