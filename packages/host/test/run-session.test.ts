import { fakeScreenPerCase } from './fake-screen.js';
import { describe, expect, it } from 'vitest';

import { parseTestSpecTsv } from '@git-qa/core';
import type { SessionState } from '@git-qa/core/session';
import type { LiveBridge, LiveBridgeOptions } from '@git-qa/live-bridge';

import { startRunSession } from '../src/index.js';
import { stubAdapter } from './stub-adapter.js';

/**
 * 一本道 — シートを読む → 端末を操作する → 人が 1 打鍵で置く → `run.json` の中身が出る。
 *
 * **人が押すまで次のケースへ進まない。**時間で勝手に進めると、人が見ようとしていた
 * ケースを見逃したまま `AUTO_PASS` が積み上がる。
 */

const SHEET = parseTestSpecTsv(
  [
    '#! md-business:test-spec-tsv/v1',
    'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
    '1\tメモを保存できる\t保存をタップする\t「保存しました」と表示される',
    '2\tメモを削除できる\t削除をタップする\t「保存しました」と表示される',
    '3\t検索できる\t検索をタップする\t「見つかりません」と表示される',
    '',
  ].join('\n'),
);

/** 橋の代わり。**publish された状態と、送り込む打鍵を握る。** */
function fakeBridge(): {
  start: (options: LiveBridgeOptions) => Promise<LiveBridge>;
  states: SessionState[];
  send: (input: unknown) => void;
  frames: () => AsyncIterable<Uint8Array>;
} {
  const states: SessionState[] = [];
  const handlers = new Set<(input: unknown) => void>();
  let source: (() => AsyncIterable<Uint8Array>) | undefined;

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
    start: (options) => {
      source = options.source;
      return Promise.resolve(bridge);
    },
    frames: () => source?.() ?? { async *[Symbol.asyncIterator]() {} },
    states,
    send: (input) => {
      for (const handler of handlers) handler(input);
    },
  };
}

const start = (bridge: ReturnType<typeof fakeBridge>, screenText = '保存しました') =>
  startRunSession({
    adapter: stubAdapter({}),
    sheet: SHEET,
    sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
    runId: '20260902-150000',
    operator: { handle: 'octocat' },
    readScreenText: fakeScreenPerCase(screenText),
    startBridge: bridge.start,
    // **検査では待たせない。**落ちる判定のたびに 2 秒待つと、検査が待ち切れない。
    expectation: { waitMs: 0, stepMs: 1 },
  });

/** 条件が満たされるまで待つ。満たされなければ、何を待っていたかを言って落ちる。 */
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

const awaitingIs = (bridge: ReturnType<typeof fakeBridge>, no: number) => () =>
  bridge.states.at(-1)?.awaiting === no;

describe('startRunSession', () => {
  it('人が置いた行だけ VERIFIED になり、送った行は AUTO_PASS のまま残る', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });

    await waitFor(awaitingIs(bridge, 2), '2 件目の打鍵待ち');
    bridge.send({ kind: 'advance', caseNo: 2 });

    await waitFor(awaitingIs(bridge, 3), '3 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 3, humanResult: 'FAIL' });

    const run = await session.done;
    await session.close();

    expect(run.cases.map((c) => c.result)).toEqual(['VERIFIED', 'AUTO_PASS', 'FAIL']);
    // **AI は 1 件目と 2 件目を同じく PASS にしている。**違うのは「人が見たかどうか」だけで、
    // それが `VERIFIED` と `AUTO_PASS` の差として証跡に残る（C1）。
    expect(run.cases.map((c) => c.aiResult)).toEqual(['PASS', 'PASS', 'FAIL']);
    expect(run.cases[0]?.verifiedBy).toBe('octocat');
    expect(run.cases[1]?.verifiedBy).toBeUndefined();
  });

  it('人が押すまで、次のケースを始めない', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    await new Promise((r) => setTimeout(r, 50));

    // 待っている間に 2 件目へ行っていない。
    expect(bridge.states.at(-1)?.awaiting).toBe(1);
    expect(bridge.states.at(-1)?.cases[1]?.aiResult).toBeUndefined();

    session.abort('検査の後始末');
    await session.done;
    await session.close();
  });

  it('別のケース宛の打鍵は捨てる（遅れて届いた打鍵が次のケースに付かない）', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 2, humanResult: 'VERIFIED' });
    await new Promise((r) => setTimeout(r, 30));
    expect(bridge.states.at(-1)?.awaiting).toBe(1);

    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });
    await waitFor(awaitingIs(bridge, 2), '2 件目の打鍵待ち');

    session.abort('検査の後始末');
    const run = await session.done;
    await session.close();
    expect(run.cases[0]?.result).toBe('VERIFIED');
  });

  /**
   * **途中で終えたら、走らせていないケースは証跡に書かない**（2026-09-12 に変えた）。
   *
   * 前は「止めたので BLOCKED」と書いていた。**走らせた末に判断保留になったケースと
   * 見分けが付かない**ので、続きから走らせるときに、どれをやり直すべきかが読めなくなる。
   *
   * 通ったことにしないのは変わらない —— **そもそも無い。**
   * **終わりの時刻が無いこと**が「途中で止まった」の印になる。
   */
  it('途中で終えたら、走らせていないケースは書かない（通ったことにしない）', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    session.abort('画面が閉じられた');

    const run = await session.done;
    await session.close();

    expect(run.cases.map((c) => c.no)).toEqual([1]);
    expect(run.cases[0]?.result).toBe('AUTO_PASS');
    expect(run.finishedAt).toBeUndefined();
  });

  it('終わったら、終わったことを画面へ流す', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    session.abort('検査の後始末');
    await session.done;
    await session.close();

    expect(bridge.states.at(-1)?.phase).toBe('finished');
    expect(bridge.states.at(-1)?.awaiting).toBeUndefined();
  });

  it('画面が読む URL を、映像と制御の両方について返す', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    expect(session.liveUrl).toBe('http://127.0.0.1:65000/live/token.h264');
    expect(session.controlUrl).toBe('http://127.0.0.1:65000/live/token/control');

    session.abort('検査の後始末');
    await session.done;
    await session.close();
  });
});

describe('人が端末を触る', () => {
  /**
   * **AI が判断保留にして止まった後、人が自分で触って確かめる**のが中心の動き。
   * 見えるが触れない画面は、判断の材料にならない（Issue 013）。
   */
  it('人の番のときは、押した所が端末へ届く', async () => {
    const bridge = fakeBridge();
    const adapter = stubAdapter({});
    const session = await startRunSession({
      adapter,
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260902-200000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
    });

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'tap', caseNo: 1, x: 540, y: 1200 });
    await waitFor(
      () => adapter.actions.some((a) => a.kind === 'tap' && a.target.at === 'point'),
      '端末への tap',
    );

    expect(adapter.actions.at(-1)).toEqual({
      kind: 'tap',
      target: { at: 'point', x: 540, y: 1200 },
    });

    session.abort('検査の後始末');
    await session.done;
    await session.close();
  });

  it('待っているケース以外宛の操作は捨てる', async () => {
    const bridge = fakeBridge();
    const adapter = stubAdapter({});
    const session = await startRunSession({
      adapter,
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260902-200100',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
    });

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    const before = adapter.actions.length;
    bridge.send({ kind: 'tap', caseNo: 3, x: 10, y: 10 });
    await new Promise((r) => setTimeout(r, 30));

    expect(adapter.actions).toHaveLength(before);

    session.abort('検査の後始末');
    await session.done;
    await session.close();
  });
});

describe('人がなぞる（スワイプ / フリック）', () => {
  it('なぞった始点・終点・時間が、そのまま端末へ届く', async () => {
    const bridge = fakeBridge();
    const adapter = stubAdapter({});
    const session = await startRunSession({
      adapter,
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260902-210000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
    });

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({
      kind: 'swipe',
      caseNo: 1,
      from: { x: 540, y: 2000 },
      to: { x: 540, y: 400 },
      durationMs: 120,
    });
    await waitFor(() => adapter.actions.some((a) => a.kind === 'swipe'), '端末への swipe');

    expect(adapter.actions.at(-1)).toEqual({
      kind: 'swipe',
      from: { at: 'point', x: 540, y: 2000 },
      to: { at: 'point', x: 540, y: 400 },
      durationMs: 120,
    });

    session.abort('検査の後始末');
    await session.done;
    await session.close();
  });
});

describe('小さく流した映像の座標を、端末の実寸へ戻す', () => {
  /**
   * **映像は端末より小さく流している**（720x1480 等）。そのままの数値を渡すと、
   * 3 分の 2 の位置を触ることになる（実機で押しても反応しなかった）。
   */
  it('送り手の画面の大きさから、実寸へ直して送る', async () => {
    const bridge = fakeBridge();
    const adapter = stubAdapter({ screen: { width: 1080, height: 2220 } });
    const session = await startRunSession({
      adapter,
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260902-220000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
    });

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'tap', caseNo: 1, x: 360, y: 740, screen: { x: 720, y: 1480 } });
    // AI 自身の操作（要素を指したもの）と混ざるので、人の操作＝座標指定を待つ。
    await waitFor(
      () => adapter.actions.some((a) => a.kind === 'tap' && a.target.at === 'point'),
      '人が押した座標',
    );

    expect(adapter.actions.at(-1)).toEqual({
      kind: 'tap',
      target: { at: 'point', x: 540, y: 1110 },
    });

    session.abort('検査の後始末');
    await session.done;
    await session.close();
  });
});

/**
 * **手数を数える（Issue 008 の主指標）。**
 *
 * 「手作業と比べて楽になったか」は所要時間で見るが、差が出なかったときに
 * **どこで食っているか**を切り分ける材料が要る。端末を触った回数は `humanActions` の
 * 長さで数えられるのに、**判定を置いた打鍵はどこにも残っていなかった。**
 *
 * 置き直しの回数もここに出る。**多いケースは、画面が分かりにくい所。**
 */
describe('手数を数える（Issue 008）', () => {
  const start = (bridge: ReturnType<typeof fakeBridge>) =>
    startRunSession({
      adapter: stubAdapter({}),
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260904-180000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
    });

  it('判定を置いた回数を数える', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });
    await waitFor(awaitingIs(bridge, 2), '2 件目の打鍵待ち');

    session.abort('検査の後始末');
    const run = await session.done;
    await session.close();

    expect(run.cases[0]?.humanInputs).toEqual({ verdict: 1, advance: 0 });
  });

  it('置き直した回数も数える（画面が分かりにくい所が出る）', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });
    await waitFor(awaitingIs(bridge, 2), '2 件目の打鍵待ち');

    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'FAIL' });
    await waitFor(() => bridge.states.at(-1)?.cases[0]?.result === 'FAIL', '1 件目の置き直し');

    session.abort('検査の後始末');
    const run = await session.done;
    await session.close();

    expect(run.cases[0]?.humanInputs).toEqual({ verdict: 2, advance: 0 });
  });

  it('置かずに送った打鍵も数える', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'advance', caseNo: 1 });
    await waitFor(awaitingIs(bridge, 2), '2 件目の打鍵待ち');

    session.abort('検査の後始末');
    const run = await session.done;
    await session.close();

    expect(run.cases[0]?.humanInputs).toEqual({ verdict: 0, advance: 1 });
  });

  it('打鍵の無かったケースには付けない（無いことにも意味がある）', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    session.abort('検査の後始末');
    const run = await session.done;
    await session.close();

    expect(run.cases[0]?.humanInputs).toBeUndefined();
  });

  it('まだ走っていないケースへの打鍵は数えない（受け取っていないので）', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 3, humanResult: 'VERIFIED' });
    await new Promise((r) => setTimeout(r, 30));

    session.abort('検査の後始末');
    const run = await session.done;
    await session.close();

    expect(run.cases[2]?.humanInputs).toBeUndefined();
  });
});

describe('判定の置き直し（Issue 013）', () => {
  /**
   * **押し間違いは起きるし、「さっきの見落とした」も起きる。**
   * 既に走ったケースなら、後から置き直せる。**まだ走っていないケースには置けない**
   * （AI が操作していないので、人が見て判断する材料が無い）。
   */
  const start = (bridge: ReturnType<typeof fakeBridge>) =>
    startRunSession({
      adapter: stubAdapter({}),
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260902-230000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
    });

  it('既に置いた判定を、後から置き直せる', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });

    await waitFor(awaitingIs(bridge, 2), '2 件目の打鍵待ち');
    // 1 件目を置き直す（見落としに気づいた）。
    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'FAIL' });
    await waitFor(() => bridge.states.at(-1)?.cases[0]?.result === 'FAIL', '1 件目の置き直し');

    // 置き直しても、待っているのは 2 件目のまま。**勝手に先へ進まない。**
    expect(bridge.states.at(-1)?.awaiting).toBe(2);

    bridge.send({ kind: 'advance', caseNo: 2 });
    await waitFor(awaitingIs(bridge, 3), '3 件目の打鍵待ち');
    session.abort('検査の後始末');

    const run = await session.done;
    await session.close();

    // 証跡にも置き直しが載る。
    expect(run.cases[0]?.result).toBe('FAIL');
    expect(run.cases[0]?.humanResult).toBe('FAIL');
    expect(run.cases[0]?.verifiedBy).toBe('octocat');
  });

  it('まだ走っていないケースには置けない', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 4, humanResult: 'VERIFIED' });
    await new Promise((r) => setTimeout(r, 30));

    expect(bridge.states.at(-1)?.cases[3]?.result).toBeUndefined();
    expect(bridge.states.at(-1)?.awaiting).toBe(1);

    session.abort('検査の後始末');
    await session.done;
    await session.close();
  });

  it('置かずに送ったケースも、後から置き直せる（AUTO_PASS → VERIFIED）', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'advance', caseNo: 1 });
    await waitFor(awaitingIs(bridge, 2), '2 件目の打鍵待ち');

    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });
    await waitFor(() => bridge.states.at(-1)?.cases[0]?.result === 'VERIFIED', '置き直し');

    session.abort('検査の後始末');
    const run = await session.done;
    await session.close();

    expect(run.cases[0]?.result).toBe('VERIFIED');
    expect(run.cases[0]?.verifiedBy).toBe('octocat');
  });
});

describe('人が触った操作を証跡に残す', () => {
  /**
   * **AI の足跡しか残らないと、「本当に人が見たのか」が読めない。**
   * 判断保留のあと人が自分で触って確かめた過程を、証跡に残す。
   */
  it('触った操作が、端末の実寸の座標で run.json に残る', async () => {
    const bridge = fakeBridge();
    const adapter = stubAdapter({ screen: { width: 1080, height: 2220 } });
    const session = await startRunSession({
      adapter,
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260903-100000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
    });

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'tap', caseNo: 1, x: 360, y: 740, screen: { x: 720, y: 1480 } });
    bridge.send({
      kind: 'swipe',
      caseNo: 1,
      from: { x: 360, y: 1400 },
      to: { x: 360, y: 200 },
      durationMs: 120,
      screen: { x: 720, y: 1480 },
    });
    await waitFor(() => adapter.actions.length >= 2, '端末への操作');

    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });
    await waitFor(awaitingIs(bridge, 2), '2 件目の打鍵待ち');
    session.abort('検査の後始末');

    const run = await session.done;
    await session.close();

    const actions = run.cases[0]?.humanActions ?? [];
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ kind: 'tap', to: { x: 540, y: 1110 } });
    expect(actions[1]).toMatchObject({
      kind: 'swipe',
      from: { x: 540, y: 2100 },
      to: { x: 540, y: 300 },
    });
    expect(typeof actions[0]?.at).toBe('string');
  });

  it('触っていないケースには残らない（「触らずに見た」も記録のうち）', async () => {
    const bridge = fakeBridge();
    const session = await startRunSession({
      adapter: stubAdapter({ screen: { width: 1080, height: 2220 } }),
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260903-100100',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
    });

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });
    await waitFor(awaitingIs(bridge, 2), '2 件目の打鍵待ち');
    session.abort('検査の後始末');

    const run = await session.done;
    await session.close();

    expect(run.cases[0]?.humanActions).toBeUndefined();
  });
});

describe('長押し', () => {
  it('同じ場所への長いなぞりとして端末へ送り、証跡には長押しとして残す', async () => {
    const bridge = fakeBridge();
    const adapter = stubAdapter({ screen: { width: 1080, height: 2220 } });
    const session = await startRunSession({
      adapter,
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260903-110000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
    });

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({
      kind: 'longPress',
      caseNo: 1,
      x: 360,
      y: 740,
      durationMs: 800,
      screen: { x: 720, y: 1480 },
    });
    // AI 自身の操作と混ざるので、長押しの実体（なぞり）を待つ。
    await waitFor(() => adapter.actions.some((a) => a.kind === 'swipe'), '端末への長押し');

    // 端末に「長押し」という命令は無い。同じ場所への長いなぞりになる。
    expect(adapter.actions.at(-1)).toEqual({
      kind: 'swipe',
      from: { at: 'point', x: 540, y: 1110 },
      to: { at: 'point', x: 540, y: 1110 },
      durationMs: 800,
    });

    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });
    await waitFor(awaitingIs(bridge, 2), '2 件目の打鍵待ち');
    session.abort('検査の後始末');

    const run = await session.done;
    await session.close();

    // 証跡には、人が何をしたかで残す。
    expect(run.cases[0]?.humanActions?.[0]).toMatchObject({ kind: 'longPress' });
  });
});

describe('文字を端末へ送る', () => {
  it('端末へ送り、証跡には中身を残さない', async () => {
    const bridge = fakeBridge();
    const adapter = stubAdapter({ screen: { width: 1080, height: 2220 } });
    const session = await startRunSession({
      adapter,
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260903-120000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
    });

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'text', caseNo: 1, text: 'hello' });
    await waitFor(() => adapter.actions.some((a) => a.kind === 'type'), '端末への文字');

    expect(adapter.actions.at(-1)).toEqual({ kind: 'type', text: 'hello' });

    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });
    await waitFor(awaitingIs(bridge, 2), '2 件目の打鍵待ち');
    session.abort('検査の後始末');

    const run = await session.done;
    await session.close();

    const action = run.cases[0]?.humanActions?.[0];
    expect(action).toMatchObject({ kind: 'text' });
    // **打った文字は証跡に残さない。**画面には顧客名や電話番号が写る（PRD §10）。
    expect(JSON.stringify(action)).not.toContain('hello');
  });
});

describe('映像が止まった理由を画面へ伝える', () => {
  /**
   * **橋は生のバイト列を流すので、途中で理由を差し込めない。**
   * 黙って終わると、画面は真っ黒のまま何も言えない（実機で踏んだ）。
   *
   * 落ちてすぐには投げない —— **繋ぎ直しに行く**（Issue 014）。戻らないまま上限に達したら投げる。
   * どちらの間も、理由は実行の状態に載っている。
   */
  it('映像が落ちたら、その理由が実行の状態に載る', async () => {
    const bridge = fakeBridge();
    const adapter = stubAdapter({ failFrames: '端末の画面が消えている' });
    const session = await startRunSession({
      adapter,
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260903-130000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
      reconnect: { intervalMs: 1, limitMs: 5, sleep: () => Promise.resolve() },
    });

    // 橋が映像を読み始めた時点で落ちる。**理由は上へ投げつつ、控えも残す。**
    await expect(
      (async () => {
        for await (const _chunk of bridge.frames()) {
          // 1 枚も来ない。
        }
      })(),
    ).rejects.toThrow(/画面が消えている/);

    await waitFor(
      () => bridge.states.at(-1)?.liveError?.includes('画面が消えている') === true,
      '止まった理由',
    );

    session.abort('検査の後始末');
    await session.done;
    await session.close();
  });
});

/**
 * **シートの見出しが宣言した対象アプリを、実行器へ渡す。**
 * ここが繋がっていないと「アプリを起動する」が必ず保留になり、
 * どの検証シートも 1 件目で止まる（2026-09-02 の実行記録がその形だった）。
 */
describe('startRunSession — 対象アプリ', () => {
  const LAUNCH_SHEET = parseTestSpecTsv(
    [
      '#! md-business:test-spec-tsv/v1',
      '# 対象: com.android.settings',
      'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
      '1\tアプリが起動する\tアプリを起動する\t「保存しました」と表示される',
      '',
    ].join('\n'),
  );

  it('見出しの「対象」を起動先にする', async () => {
    const bridge = fakeBridge();
    const adapter = stubAdapter({});
    const session = await startRunSession({
      adapter,
      sheet: LAUNCH_SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260902-150000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
    });

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });
    await session.done;
    await session.close();

    expect(adapter.actions).toEqual([{ kind: 'launch', app: 'com.android.settings' }]);
  });
});

/**
 * **置いた判定が保存されないなら、この製品は何もしていない。**
 *
 * 配布物（`.app`）は `--serve` で動くが、その経路には `run.json` を書く処理が無かった。
 * 人が 5 件を置いても、どこにも残らないまま終わっていた（2026-09-04・実機で踏んだ）。
 * 保存は実行の一部として持つ。**そして、どこへ置いたかを人に見せる。**
 */
describe('startRunSession — 証跡の保存', () => {
  it('置き終わったら保存して、その場所を画面へ出す', async () => {
    const bridge = fakeBridge();
    const saved: unknown[] = [];
    const session = await startRunSession({
      adapter: stubAdapter({}),
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260902-150000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
      saveRun: (run) => {
        saved.push(run);
        return Promise.resolve('/home/me/runs/20260902-150000/run.json');
      },
    });

    for (const no of [1, 2, 3]) {
      await waitFor(awaitingIs(bridge, no), `${String(no)} 件目の打鍵待ち`);
      bridge.send({ kind: 'verdict', caseNo: no, humanResult: 'VERIFIED' });
    }
    await session.done;
    await session.close();

    expect(saved).toHaveLength(1);
    expect(bridge.states.at(-1)?.runJsonPath).toBe('/home/me/runs/20260902-150000/run.json');
  });

  it('保存に失敗したら、黙らずに理由を出す', async () => {
    const bridge = fakeBridge();
    const session = await startRunSession({
      adapter: stubAdapter({}),
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260902-150000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
      saveRun: () => Promise.reject(new Error('EROFS: read-only file system')),
    });

    for (const no of [1, 2, 3]) {
      await waitFor(awaitingIs(bridge, no), `${String(no)} 件目の打鍵待ち`);
      bridge.send({ kind: 'verdict', caseNo: no, humanResult: 'VERIFIED' });
    }
    // **置いた判定そのものは失わない。**保存に失敗しても、中身は返る。
    const run = await session.done;
    await session.close();

    expect(run.cases.map((c) => c.result)).toEqual(['VERIFIED', 'VERIFIED', 'VERIFIED']);
    expect(bridge.states.at(-1)?.saveError).toContain('EROFS');
  });
});

/**
 * **`行き先` が、人が見ている実行では効いていなかった**（外部レビュー meta-taro/git-qa#37）。
 *
 * 無人で流す道（`headless.ts`）は `sheetDestination` を見ていたのに、
 * **こちらは `対象` を直に読んでいた。**`#22` で 2 か所を揃え損ねた。
 *
 * 証跡には `destination` が正しく残るのに、**手順だけが「開く先が決められない」**と言う ——
 * **書いた人からは、何が効いていないのか分からない。**
 */
describe('行き先（#37）', () => {
  const sheetWith = (head: readonly string[]) =>
    parseTestSpecTsv(
      [
        '#! md-business:test-spec-tsv/v1',
        ...head,
        'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
        '1\tページが出る\tページを開く\t「ようこそ」と表示される',
        '',
      ].join('\n'),
    );

  const startedWith = async (head: readonly string[]): Promise<string> => {
    const bridge = fakeBridge();
    const session = await startRunSession({
      adapter: stubAdapter({}),
      sheet: sheetWith(head),
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260921-100000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('ようこそ'),
      startBridge: bridge.start,
      // **検査では待たせない。**
      expectation: { waitMs: 0, stepMs: 1 },
    });
    // **人が置くまで進まない**ので、1 件だけ置いて終わらせる。
    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });

    const run = await session.done;
    await session.close();
    return run.cases[0]?.note ?? '';
  };

  it('「# 行き先:」が在れば、そちらを開く（対象がリポジトリでも止まらない）', async () => {
    const note = await startedWith([
      '# 対象: owner/repo@develop',
      '# 行き先: http://localhost:3000/',
    ]);

    // **止まらない。**止まるなら、行き先が手順へ届いていない。
    expect(note).not.toContain('パッケージ名でも URL でもない');
  });

  it('「# 行き先:」が無ければ、今までどおり「# 対象:」を見る', async () => {
    const note = await startedWith(['# 対象: http://localhost:3000/']);

    expect(note).not.toContain('パッケージ名でも URL でもない');
  });
});
