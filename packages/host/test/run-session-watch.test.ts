import { fakeScreenPerCase } from './fake-screen.js';
import { describe, expect, it } from 'vitest';

import { parseTestSpecTsv } from '@git-qa/core';
import type { SessionState } from '@git-qa/core/session';
import type { LiveBridge, LiveBridgeOptions } from '@git-qa/live-bridge';

import { startRunSession } from '../src/index.js';
import { stubAdapter } from './stub-adapter.js';

/**
 * **鑑賞モード**（2026-09-11・人の指示）。
 *
 * > auto を git-qa まんま操作するパターンを実装します。……人はぼーっとみながら
 * > AI のテストを鑑賞します。そのときに AI 側は、テスト判定のキャプチャと、
 * > 動画をとっていきます。途中で止められる配慮も必要です。
 *
 * 普段の一本道は**人が押すまで進まない。**鑑賞モードはその逆で、
 * **押さなければ進む。**押せば、その判定になる。
 * **押していないものを「人が見て置いた」にはしない**（`AUTO_PASS`・C1）。
 */

const SHEET = parseTestSpecTsv(
  [
    '#! md-business:test-spec-tsv/v1',
    'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
    '1\tメモを保存できる\t保存をタップする\t「保存しました」と表示される',
    '2\tメモを削除できる\t削除をタップする\t「保存しました」と表示される',
    '3\t検索できる\t検索をタップする\t「保存しました」と表示される',
    '',
  ].join('\n'),
);

function fakeBridge(): {
  start: (options: LiveBridgeOptions) => Promise<LiveBridge>;
  states: SessionState[];
  send: (input: unknown) => void;
} {
  const states: SessionState[] = [];
  const handlers = new Set<(input: unknown) => void>();

  const bridge: LiveBridge = {
    url: 'http://127.0.0.1:65000/live/token.h264',
    controlUrl: 'http://127.0.0.1:65000/live/token/control',
    port: 65000,
    publish: (state) => states.push(state as SessionState),
    onInput: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close: () => Promise.resolve(),
  };

  return {
    start: () => Promise.resolve(bridge),
    states,
    send: (input) => {
      for (const handler of handlers) handler(input);
    },
  };
}

/** 待たない「間」。**検査で本当に 4 秒待つ理由は無い。** */
const noPause = (): Promise<void> => Promise.resolve();

const start = (
  bridge: ReturnType<typeof fakeBridge>,
  watch: { pauseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
) =>
  startRunSession({
    adapter: stubAdapter({}),
    sheet: SHEET,
    sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
    runId: '20260911-190000',
    operator: { handle: 'octocat' },
    readScreenText: fakeScreenPerCase('保存しました'),
    startBridge: bridge.start,
    // **検査では待たせない。**落ちる判定のたびに 2 秒待つと、検査が待ち切れない。
    expectation: { waitMs: 0, stepMs: 1 },
    watch: { sleep: noPause, ...watch },
  });

/**
 * 条件が満たされるまで待つ。満たされなければ、何を待っていたかを言って落ちる。
 *
 * **回数ではなく時計で待つ**（2026-09-14）。前は 400 回 × 5 ms で数えていたが、
 * **込み合った機械では `setTimeout(5)` が 5 ms で返らない。**
 * 待っている中身は速いのに、**数え終わってしまって落ちていた**（CI でだけ出た）。
 *
 * **検査が遅い機械で落ちるのは、検査の作りのほう。**
 */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`待っても起きなかった: ${label}`);
}

describe('startRunSession — 鑑賞モード', () => {
  it('人が押さなくても最後まで走る（置いていないので AUTO_PASS）', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    const run = await session.done;
    await session.close();

    expect(run.cases.map((c) => c.result)).toEqual(['AUTO_PASS', 'AUTO_PASS', 'AUTO_PASS']);
    // **見ていた人の名前を勝手に置かない。**押していないものは、誰のものでもない。
    expect(run.cases.map((c) => c.verifiedBy)).toEqual([undefined, undefined, undefined]);
  });

  /**
   * **証跡に「押さなくても進む形だった」と書く。**
   * `assisted`（押すまで待つ）とも `auto`（誰も見ていない）とも混ぜない。
   */
  it('証跡のモードは watched', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    expect((await session.done).mode).toBe('watched');
    await session.close();
  });

  /** 見ている人が押したら、**その判定になる。** */
  it('押せば、見ていた人の判定として残る', async () => {
    const bridge = fakeBridge();
    // 1 件目だけ、押されるまで進まないようにする。
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const session = await start(bridge, {
      sleep: () => {
        if (!first) return Promise.resolve();
        first = false;
        return held;
      },
    });

    await waitFor(() => bridge.states.at(-1)?.awaiting === 1, '1 件目を見せている');
    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'FAIL' });
    release();

    const run = await session.done;
    await session.close();

    expect(run.cases[0]?.result).toBe('FAIL');
    expect(run.cases[0]?.verifiedBy).toBe('octocat');
  });

  /**
   * **止められる配慮。**
   *
   * 止めた先のケースは**証跡に書かない**（2026-09-12 に変えた）。
   * 前は「止めたので BLOCKED」と書いていたが、**走らせた末に判断保留になったケースと
   * 見分けが付かない。**続きから走らせるときに、どれをやり直すべきかが読めなくなる。
   * **終わりの時刻が無いこと**が「途中で止まった」の印になる。
   */
  it('止めたら、そこで終わる（走らせていないケースは書かない）', async () => {
    const bridge = fakeBridge();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const session = await start(bridge, {
      sleep: () => {
        if (!first) return Promise.resolve();
        first = false;
        return held;
      },
    });

    await waitFor(() => bridge.states.at(-1)?.awaiting === 1, '1 件目を見せている');
    bridge.send({ kind: 'stop', caseNo: 1 });
    release();

    const run = await session.done;
    await session.close();

    expect(run.cases[0]?.result).toBe('AUTO_PASS');
    // 2 件目から後は走っていない。**通ったことにも、判断保留にもしない。**
    expect(run.cases.map((c) => c.no)).toEqual([1]);
    // **終わりの時刻が無い。**これが「途中で止まった」の印で、続きから走らせる目印になる。
    expect(run.finishedAt).toBeUndefined();
  });

  /** **押さなくても進むことを、画面に出し続ける。** */
  it('鑑賞中であることと、間の長さを画面へ渡す', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge, { pauseMs: 2500 });
    await session.done;
    await session.close();

    const watching = bridge.states.filter((s) => s.phase === 'watching');
    expect(watching.length).toBeGreaterThan(0);
    expect(watching[0]?.watch).toEqual({ pauseMs: 2500 });
  });
});
