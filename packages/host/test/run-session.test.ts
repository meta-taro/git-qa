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

const start = (bridge: ReturnType<typeof fakeBridge>, screenText = '保存しました') =>
  startRunSession({
    adapter: stubAdapter({}),
    sheet: SHEET,
    sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
    runId: '20260902-150000',
    operator: { handle: 'octocat' },
    readScreenText: () => Promise.resolve(screenText),
    startBridge: bridge.start,
  });

/** 条件が満たされるまで待つ。満たされなければ、何を待っていたかを言って落ちる。 */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
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

  it('途中で終えたら、残りは BLOCKED として残る（通ったことにしない）', async () => {
    const bridge = fakeBridge();
    const session = await start(bridge);

    await waitFor(awaitingIs(bridge, 1), '1 件目の打鍵待ち');
    session.abort('画面が閉じられた');

    const run = await session.done;
    await session.close();

    expect(run.cases.map((c) => c.result)).toEqual(['AUTO_PASS', 'BLOCKED', 'BLOCKED']);
    expect(run.cases[1]?.note).toContain('画面が閉じられた');
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
      readScreenText: () => Promise.resolve('保存しました'),
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
      readScreenText: () => Promise.resolve('保存しました'),
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
      readScreenText: () => Promise.resolve('保存しました'),
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
      readScreenText: () => Promise.resolve('保存しました'),
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
      readScreenText: () => Promise.resolve('保存しました'),
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
      readScreenText: () => Promise.resolve('保存しました'),
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
      readScreenText: () => Promise.resolve('保存しました'),
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
      readScreenText: () => Promise.resolve('保存しました'),
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
      readScreenText: () => Promise.resolve('保存しました'),
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
