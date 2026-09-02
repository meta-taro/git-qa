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
