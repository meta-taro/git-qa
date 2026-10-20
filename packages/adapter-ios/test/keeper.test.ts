import { describe, expect, it } from 'vitest';

import { keeperSettings, startWdaKeeper, type KeptProcess } from '../src/keeper.js';

/**
 * **Windows で iPhone / iPad の口（WebDriverAgent）を、git-qa が立てて見張る**（2026-10-20・C103）。
 *
 * 人は go-ios の 3 本（tunnel・runwda・forward）を手で立て、USB が繋がり直すたびに手で立て直していた。
 * 実機（Windows 11 ARM64・go-ios 1.3.2）で見た落ち方：
 * - tunnel は終わらずに居座り、`data plane stopped` のあと約 3 秒で自分で `tunnel negotiated` に戻る
 * - runwda は tunnel が落ちたのと同じ秒に終わる
 * - forward は居座るが、通さなくなる（立て直すと通った）
 * 準備ができたかは `/status` の `ready` だけで見る（runwda の `authorized: true` の後でも死んだ）。
 */
interface Fake extends KeptProcess {
  readonly args: readonly string[];
  killed: boolean;
  say(line: string): void;
  die(): void;
}

function harness(options: { readyAfter?: number } = {}) {
  const spawned: Fake[] = [];
  const logs: string[] = [];
  let polls = 0;
  let readyFrom = options.readyAfter ?? 1;
  const spawn = (_cmd: string, args: readonly string[]): KeptProcess => {
    const lines: ((line: string) => void)[] = [];
    const exits: (() => void)[] = [];
    const one: Fake = {
      args,
      killed: false,
      onLine: (cb) => lines.push(cb),
      onExit: (cb) => exits.push(cb),
      kill() {
        if (one.killed) return;
        one.killed = true;
        for (const cb of exits) cb();
      },
      say: (line) => {
        for (const cb of lines) cb(line);
      },
      die() {
        one.killed = true;
        for (const cb of exits) cb();
      },
    };
    spawned.push(one);
    return one;
  };
  const keeper = startWdaKeeper({
    iosPath: 'ios.exe',
    udid: 'UDID-1',
    bundleId: 'com.example.WebDriverAgentRunner.xctrunner',
    spawn,
    isReady: () => Promise.resolve(++polls >= readyFrom),
    wait: () => Promise.resolve(),
    log: (line) => logs.push(line),
  });
  const alive = (kind: string) => spawned.filter((p) => p.args[0] === kind && !p.killed);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    keeper,
    spawned,
    logs,
    alive,
    settle,
    notReadyUntil: (n: number) => {
      polls = 0;
      readyFrom = n;
    },
  };
}

const NEGOTIATED = '{"level":"info","msg":"userspace tunnel negotiated","grantedMtu":1280}';
const STOPPED =
  '{"level":"error","msg":"userspace tunnel data plane stopped unexpectedly, tearing down tunnel"}';

describe('startWdaKeeper', () => {
  it('まず tunnel だけを、端末を指して立てる', () => {
    const { spawned } = harness();
    expect(spawned.map((p) => p.args)).toEqual([
      ['tunnel', 'start', '--userspace', '--udid=UDID-1'],
    ]);
  });

  it('tunnel が繋がってから runwda、そのあと forward 2 本を立て、/status の ready で準備完了', async () => {
    const { keeper, alive, settle } = harness();
    const ready = keeper.ready();
    alive('tunnel')[0]!.say(NEGOTIATED);
    await ready;
    await settle();
    expect(alive('runwda')[0]!.args).toEqual([
      'runwda',
      '--bundleid=com.example.WebDriverAgentRunner.xctrunner',
      '--testrunnerbundleid=com.example.WebDriverAgentRunner.xctrunner',
      '--xctestconfig=WebDriverAgentRunner.xctest',
      '--udid=UDID-1',
    ]);
    expect(alive('forward').map((p) => p.args)).toEqual([
      ['forward', '8100', '8100', '--udid=UDID-1'],
      ['forward', '9100', '9100', '--udid=UDID-1'],
    ]);
    expect(keeper.url).toBe('http://127.0.0.1:8100');
  });

  it('tunnel が落ちたら runwda と forward を畳み、張り直したら立て直す', async () => {
    const { keeper, alive, settle, spawned } = harness();
    const tunnel = alive('tunnel')[0]!;
    tunnel.say(NEGOTIATED);
    await keeper.ready();
    const first = spawned.filter((p) => p.args[0] !== 'tunnel');

    tunnel.say(STOPPED);
    expect(first.every((p) => p.killed)).toBe(true);
    expect(alive('tunnel')).toHaveLength(1); // tunnel は居座るので、触らない

    const again = keeper.ready();
    tunnel.say(NEGOTIATED);
    await again;
    await settle();
    expect(alive('runwda')).toHaveLength(1);
    expect(alive('forward')).toHaveLength(2);
  });

  it('runwda だけが死んだら、tunnel が生きている限り runwda と forward を立て直す', async () => {
    const { keeper, alive, settle } = harness();
    alive('tunnel')[0]!.say(NEGOTIATED);
    await keeper.ready();
    const oldForwards = alive('forward');

    alive('runwda')[0]!.die();
    await keeper.ready();
    await settle();
    expect(oldForwards.every((p) => p.killed)).toBe(true);
    expect(alive('runwda')).toHaveLength(1);
    expect(alive('forward')).toHaveLength(2);
  });

  it('立て直している間は、準備完了と言わない', async () => {
    const h = harness();
    h.alive('tunnel')[0]!.say(NEGOTIATED);
    await h.keeper.ready();
    expect(h.keeper.isReady).toBe(true);
    h.alive('tunnel')[0]!.say(STOPPED);
    expect(h.keeper.isReady).toBe(false);
  });

  it('tunnel そのものが終わったら、立て直す', async () => {
    const { alive, settle } = harness();
    alive('tunnel')[0]!.die();
    await settle();
    expect(alive('tunnel')).toHaveLength(1);
  });

  it('閉じたら全部を止め、もう立て直さない', async () => {
    const { keeper, alive, spawned, settle } = harness();
    alive('tunnel')[0]!.say(NEGOTIATED);
    await keeper.ready();
    keeper.close();
    await settle();
    expect(spawned.every((p) => p.killed)).toBe(true);
    expect(spawned.filter((p) => !p.killed)).toHaveLength(0);
  });

  /**
   * 実機（macOS・iPhone Xs・iOS 18.7.10）で踏んだ。開発用のディスクイメージが載っていないと、
   * runwda は数秒で終わり、立て直しても同じことを繰り返す。go-ios 自身が `ios image auto` を勧める。
   */
  it('開発用のディスクイメージが無いと言われたら、1 度だけ載せてから立て直す', async () => {
    const { keeper, alive, spawned, settle } = harness();
    alive('tunnel')[0]!.say(NEGOTIATED);
    await settle();
    const runwda = alive('runwda')[0]!;
    runwda.say(
      '{"level":"error","msg":"Failed running WDA","error":"service \'com.apple.dt.testmanagerd.remote\' is not available in RSD. ... (run `ios image auto`)"}',
    );
    runwda.die();
    await settle();
    const image = alive('image')[0]!;
    expect(image.args).toEqual(['image', 'auto', '--udid=UDID-1']);

    const ready = keeper.ready();
    image.die();
    await ready;
    expect(spawned.filter((p) => p.args[0] === 'runwda')).toHaveLength(2);

    // 2 度目は載せない（直らないものを繰り返さない）
    alive('runwda')[0]!.say('... is not available in RSD ... `ios image auto`');
    alive('runwda')[0]!.die();
    await settle();
    expect(spawned.filter((p) => p.args[0] === 'image')).toHaveLength(1);
  });

  it('WebDriverAgent が終わったら、go-ios が言った理由を添える', async () => {
    const { keeper, alive, logs, settle } = harness();
    alive('tunnel')[0]!.say(NEGOTIATED);
    await keeper.ready();
    const runwda = alive('runwda')[0]!;
    runwda.say(
      '{"level":"error","msg":"Failed running WDA","error":"lost connection to testmanagerd"}',
    );
    runwda.die();
    await settle();
    expect(logs.join('\n')).toContain('lost connection to testmanagerd');
  });

  it('何が起きたかを人に分かる言葉で残す', async () => {
    const { keeper, alive, logs } = harness();
    alive('tunnel')[0]!.say(NEGOTIATED);
    await keeper.ready();
    alive('tunnel')[0]!.say(STOPPED);
    expect(logs.join('\n')).toMatch(/準備ができた/);
    expect(logs.join('\n')).toMatch(/切れた/);
  });
});

describe('keeperSettings — 環境変数から', () => {
  it('GIT_QA_IOS_GO が無ければ、立てない（今までどおり人が立てる）', () => {
    expect(keeperSettings({})).toBeUndefined();
  });

  it('GIT_QA_IOS_WDA が渡されていれば、そちらを使う（人が立てた口を奪わない）', () => {
    expect(
      keeperSettings({ GIT_QA_IOS_GO: 'ios.exe', GIT_QA_IOS_WDA: 'http://127.0.0.1:8100' }),
    ).toBeUndefined();
  });

  it('端末と Bundle ID がそろえば、立てる設定を返す', () => {
    expect(
      keeperSettings({
        GIT_QA_IOS_GO: 'C:\\tools\\ios.exe',
        GIT_QA_IOS_UDID: 'UDID-1',
        GIT_QA_IOS_WDA_BUNDLE: 'com.example.WebDriverAgentRunner.xctrunner',
      }),
    ).toEqual({
      iosPath: 'C:\\tools\\ios.exe',
      udid: 'UDID-1',
      bundleId: 'com.example.WebDriverAgentRunner.xctrunner',
    });
  });

  it('足りないものがあれば、何が足りないかを言って止まる', () => {
    expect(() => keeperSettings({ GIT_QA_IOS_GO: 'ios.exe' })).toThrow(
      /GIT_QA_IOS_UDID.*GIT_QA_IOS_WDA_BUNDLE/,
    );
  });
});
