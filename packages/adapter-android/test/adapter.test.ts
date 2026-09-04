import { describe, expect, it } from 'vitest';

import { describeAdapterContract } from '@git-qa/core/testing';
import type { TargetAdapter } from '@git-qa/core';

import { createAndroidAdapter, listAndroidDevices, readAndroidScreenText } from '../src/index.js';
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
    runner.chunks = [new Uint8Array([1])];
    const session = await streaming(runner).connect();
    await session.liveView.open();
    // **読み手が繋いだ時点で起こす。**開いただけでは端末を触らない。
    for await (const _chunk of session.liveView.frames!()) break;

    expect(runner.streamed.at(-1)).toEqual([
      '-s',
      'emulator-5554',
      'exec-out',
      'screenrecord',
      '--output-format=h264',
      '--time-limit=180',
      // 人が判断できる大きさで足りる。大きいほど操作から画面に出るまでが延びる。
      '--size',
      '720x1480',
      '--bit-rate',
      '4000000',
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
    runner.chunks = [new Uint8Array([1])];
    for await (const _chunk of session.liveView.frames!()) break;

    expect(runner.streamed.at(-1)).toContain('--time-limit=180');
  });

  it('流れてきたものを、そのまま読める', async () => {
    const runner = fakeRunner();
    runner.chunks = [new Uint8Array([0, 0, 1, 0x67]), new Uint8Array([0, 0, 1, 0x65])];
    const session = await streaming(runner).connect();
    await session.liveView.open();

    // **繋ぎ直すので、勝手には尽きない**（screenrecord の 180 秒上限があるため）。
    // 流したぶんだけ読んで、中身が変わっていないことを見る。
    const got: Uint8Array[] = [];
    for await (const chunk of session.liveView.frames?.() ?? []) {
      got.push(chunk);
      if (got.length === runner.chunks.length) break;
    }
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
    runner.chunks = [new Uint8Array([1])];
    const session = await streaming(runner).connect();
    await session.liveView.open();
    // 読み手がいる状態にしてから閉じる（開いただけでは端末を触らない）。
    for await (const _chunk of session.liveView.frames!()) break;
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

describe('readAndroidScreenText — セッションから画面の文字を取る', () => {
  it('uiautomator の dump から、画面で読める文字を集める', async () => {
    const session = await makeAdapter().connect();

    // 期待結果（「〜と表示される」）との突き合わせに使う所。
    await expect(readAndroidScreenText(session)).resolves.toContain('保存');
  });
});

describe('ライブ映像の繋ぎ直し', () => {
  /**
   * `screenrecord` には 180 秒の上限がある。**人は窓を開けっぱなしにする**ので、
   * 上限で切れたまま黙ると、画面が固まったように見える（実機で 3 時間半後に 0 バイトになった）。
   */
  const take = async (frames: AsyncIterable<Uint8Array>, count: number): Promise<number> => {
    let seen = 0;
    for await (const _chunk of frames) {
      seen += 1;
      if (seen >= count) break;
    }
    return seen;
  };

  it('上限で切れても、繋ぎ直して映像が続く', async () => {
    const runner = fakeRunner();
    runner.chunks = [new Uint8Array([1]), new Uint8Array([2])];
    const adapter = createAndroidAdapter({ build, runner, liveView: { mode: 'h264-stream' } });
    const session = await adapter.connect();
    await session.liveView.open();

    const seen = await take(session.liveView.frames!(), 5);

    expect(seen).toBe(5);
    // 1 本 2 枚しか流れないので、5 枚読むには繋ぎ直しが要る。
    expect(runner.streamed.length).toBeGreaterThanOrEqual(3);
  });

  it('閉じたら繋ぎ直さない（端末を掴んだままにしない）', async () => {
    const runner = fakeRunner();
    runner.chunks = [new Uint8Array([1])];
    const adapter = createAndroidAdapter({ build, runner, liveView: { mode: 'h264-stream' } });
    const session = await adapter.connect();
    await session.liveView.open();

    const frames = session.liveView.frames!();
    for await (const _chunk of frames) {
      await session.liveView.close();
      break;
    }
    const after = runner.streamed.length;
    // 閉じた後に読み直しても、新しい screenrecord は起きない。
    expect(after).toBe(1);
  });
});

describe('映像の読み手が入れ替わったとき', () => {
  const streamingAdapter = (runner: CommandRunner): TargetAdapter =>
    createAndroidAdapter({ build, runner, liveView: { mode: 'h264-stream' } });

  /**
   * **画面を読み込み直すと、橋へ繋ぎ直しに来る**（vite の再読み込み・webview の復帰）。
   * 端末側の映像を 1 回しか流せない作りだと、2 回目は真っ黒になる（**実機で起きた**）。
   */
  const drain = async (frames: AsyncIterable<Uint8Array>, count: number): Promise<number> => {
    let seen = 0;
    for await (const _chunk of frames) {
      seen += 1;
      if (seen >= count) break;
    }
    return seen;
  };

  it('読み直しても、また映像が来る', async () => {
    const runner = fakeRunner();
    runner.chunks = [new Uint8Array([1]), new Uint8Array([2])];
    const session = await streamingAdapter(runner).connect();
    await session.liveView.open();

    expect(await drain(session.liveView.frames!(), 2)).toBe(2);
    // 1 人目が去った後、2 人目が繋いでくる。
    expect(await drain(session.liveView.frames!(), 2)).toBe(2);
  });

  it('読み手が去ったら、端末側の取り込みも止める', async () => {
    const runner = fakeRunner();
    runner.chunks = [new Uint8Array([1])];
    const session = await streamingAdapter(runner).connect();
    await session.liveView.open();

    await drain(session.liveView.frames!(), 1);

    // 止めないと、screenrecord が端末に残り続ける。
    expect(runner.processes.some((p) => !p.isRunning)).toBe(true);
  });
});

describe('listAndroidDevices — 繋がっている端末を並べる', () => {
  /**
   * **アプリを入口にするために要る**（Issue 011 段階 3）。
   * いまはターミナルで `adb devices` を打つしかなく、人が端末を選べない。
   */
  it('見えている端末を返す', async () => {
    const runner = fakeRunner();

    const devices = await listAndroidDevices({ runner });

    expect(devices).toEqual([{ serial: 'emulator-5554', state: 'device' }]);
  });

  it('1 台も見えていなければ空（落とさない）', async () => {
    // **選ぶ前の画面で落とすと、人は次に何をすればよいか分からない。**
    const runner = fakeRunner({
      devices: {
        code: 0,
        stdout: new TextEncoder().encode('List of devices attached\n'),
        stderr: '',
      },
    });

    await expect(listAndroidDevices({ runner })).resolves.toEqual([]);
  });
});

describe('映像が 1 枚も来なかったとき', () => {
  /**
   * **画面が消えていると screenrecord は 1 枚も返さない**（実機で踏んだ）。
   * 「映像が来ない」ではなく「画面が消えている」と言えるようにする。
   */
  const drainAll = async (frames: AsyncIterable<Uint8Array>): Promise<void> => {
    for await (const _chunk of frames) {
      // 1 枚も来ない前提。
    }
  };

  it('画面が消えていたら、そう言う', async () => {
    const runner = fakeRunner({
      'shell dumpsys power': {
        code: 0,
        stdout: new TextEncoder().encode('  mWakefulness=Asleep\n'),
        stderr: '',
      },
    });
    runner.chunks = [];
    const session = await createAndroidAdapter({
      build,
      runner,
      liveView: { mode: 'h264-stream' },
    }).connect();
    await session.liveView.open();

    await expect(drainAll(session.liveView.frames!())).rejects.toThrow(/画面が消えている/);
  });

  it('画面は点いているのに来ないなら、そちらの理由を言う', async () => {
    const runner = fakeRunner({
      'shell dumpsys power': {
        code: 0,
        stdout: new TextEncoder().encode('  mWakefulness=Awake\n'),
        stderr: '',
      },
    });
    runner.chunks = [];
    const session = await createAndroidAdapter({
      build,
      runner,
      liveView: { mode: 'h264-stream' },
    }).connect();
    await session.liveView.open();

    await expect(drainAll(session.liveView.frames!())).rejects.toThrow(/1 枚も返さずに終わった/);
  });
});

describe('起動', () => {
  it('起動先を端末に聞いてから am start する', async () => {
    const runner = fakeRunner({
      'shell cmd package resolve-activity --brief com.android.settings': {
        code: 0,
        stdout: new TextEncoder().encode(
          'priority=0 isDefault=true\ncom.android.settings/.Settings\n',
        ),
        stderr: '',
      },
    });
    const session = await createAndroidAdapter({
      build,
      runner,
      now: () => new Date('2026-09-02T00:00:00Z'),
    }).connect();

    await session.act({ kind: 'launch', app: 'com.android.settings' });

    expect(runner.ran.at(-1)?.slice(-5)).toEqual([
      'shell',
      'am',
      'start',
      '-n',
      'com.android.settings/.Settings',
    ]);
  });

  it('端末に無いアプリは、触らずに理由を出す', async () => {
    const runner = fakeRunner({
      'shell cmd package resolve-activity --brief com.example.nope': {
        code: 0,
        stdout: new TextEncoder().encode('No activity found\n'),
        stderr: '',
      },
    });
    const session = await createAndroidAdapter({
      build,
      runner,
      now: () => new Date('2026-09-02T00:00:00Z'),
    }).connect();

    await expect(session.act({ kind: 'launch', app: 'com.example.nope' })).rejects.toThrow(
      /com\.example\.nope/,
    );
    expect(
      runner.ran.map((a) => a.join(' ')).filter((c) => c.startsWith('shell am start')),
    ).toEqual([]);
  });
});

/**
 * **画面はすぐには変わらない。**
 *
 * 押した直後に次の操作を送ると、まだ前の画面にいる。文字を送っても行き先が無く、
 * 黙って捨てられる（2026-09-04 の実機実行で 5 件目がこれで FAIL した）。
 * ここは人が待つのと同じで、**少し待ってから次へ行く。**
 */
describe('画面が落ち着くのを待つ', () => {
  it('操作のあいだに待つ', async () => {
    const waited: number[] = [];
    const session = await createAndroidAdapter({
      build,
      runner: fakeRunner(),
      now: () => new Date('2026-09-02T00:00:00Z'),
      sleep: (ms) => {
        waited.push(ms);
        return Promise.resolve();
      },
    }).connect();

    await session.act({ kind: 'tap', target: { at: 'point', x: 1, y: 2 } });

    expect(waited.length).toBeGreaterThan(0);
  });

  it('まだ出ていない要素は、少し待って探し直す', async () => {
    // 1 回目の dump には無く、2 回目に出てくる画面。
    let dumps = 0;
    const runner = fakeRunner();
    const inner = runner.run.bind(runner);
    runner.run = (command: string, args: readonly string[]) => {
      if (args.join(' ').includes('cat /sdcard/git-qa-window-dump.xml')) {
        dumps += 1;
        return Promise.resolve({
          code: 0,
          stdout: new TextEncoder().encode(dumps === 1 ? '<hierarchy rotation="0" />' : DUMP),
          stderr: '',
        });
      }
      return inner(command, args);
    };

    const session = await createAndroidAdapter({
      build,
      runner,
      now: () => new Date('2026-09-02T00:00:00Z'),
      sleep: () => Promise.resolve(),
    }).connect();

    await session.act({ kind: 'tap', target: { at: 'element', ref: '保存' } });

    expect(dumps).toBeGreaterThan(1);
    expect(runner.ran.at(-1)?.slice(-4)).toEqual(['input', 'tap', '200', '240']);
  });

  it('待っても出てこなければ、見つからないと言う', async () => {
    const runner = fakeRunner({
      'shell cat /sdcard/git-qa-window-dump.xml': {
        code: 0,
        stdout: new TextEncoder().encode('<hierarchy rotation="0" />'),
        stderr: '',
      },
    });
    const session = await createAndroidAdapter({
      build,
      runner,
      now: () => new Date('2026-09-02T00:00:00Z'),
      sleep: () => Promise.resolve(),
    }).connect();

    await expect(
      session.act({ kind: 'tap', target: { at: 'element', ref: '保存' } }),
    ).rejects.toThrow(/保存/);
  });
});

/**
 * **送った文字は、黙って捨てられることがある。**
 *
 * 画面が切り替わった直後は、入力先がまだ受け取れる状態になっていない。
 * 実測（エミュレータ・2026-09-04）では 0.5 秒待っても入らず、1.0 秒で入った。
 * **待つ長さを決め打ちにすると、端末が変わった瞬間に破れる。**
 * だから時間ではなく、**入ったかどうかを見て、入っていなければもう一度送る。**
 */
describe('入力が入ったことを確かめる', () => {
  const typed = (text: string) =>
    `<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0">
  <node index="0" text="${text}" class="android.widget.EditText" bounds="[0,0][100,50]" />
</hierarchy>`;

  const runnerWithDumps = (dumps: string[]) => {
    const runner = fakeRunner();
    const inner = runner.run.bind(runner);
    let i = 0;
    runner.run = (command: string, args: readonly string[]) => {
      if (args.join(' ').includes('cat /sdcard/git-qa-window-dump.xml')) {
        const xml = dumps[Math.min(i, dumps.length - 1)] ?? '';
        i += 1;
        return Promise.resolve({ code: 0, stdout: new TextEncoder().encode(xml), stderr: '' });
      }
      return inner(command, args);
    };
    return runner;
  };

  const connect = async (runner: ReturnType<typeof fakeRunner>) =>
    createAndroidAdapter({
      build,
      runner,
      now: () => new Date('2026-09-02T00:00:00Z'),
      sleep: () => Promise.resolve(),
    }).connect();

  it('入っていなければ、もう一度送る', async () => {
    const runner = runnerWithDumps([typed('Search settings'), typed('battery')]);
    const session = await connect(runner);

    await session.act({ kind: 'type', text: 'battery' });

    const sent = runner.ran.filter((a) => a.includes('text') && a.includes('battery'));
    expect(sent).toHaveLength(2);
  });

  it('入っていれば、二度送らない（二重入力にしない）', async () => {
    const runner = runnerWithDumps([typed('battery')]);
    const session = await connect(runner);

    await session.act({ kind: 'type', text: 'battery' });

    const sent = runner.ran.filter((a) => a.includes('text') && a.includes('battery'));
    expect(sent).toHaveLength(1);
  });

  it('何度送っても入らないなら、諦めて先へ進む（勝手に落とさない）', async () => {
    // 伏せ字の欄のように、入れても画面に出ない欄がある。**入らない＝失敗ではない。**
    const runner = runnerWithDumps([typed('Search settings')]);
    const session = await connect(runner);

    await expect(session.act({ kind: 'type', text: 'battery' })).resolves.toBeUndefined();
  });
});
