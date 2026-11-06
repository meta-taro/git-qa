import { describe, expect, it } from 'vitest';

import { parseTestSpecTsv } from '@git-qa/core';

import { startRunSession } from '../src/index.js';
import { fakeBridge } from './fake-bridge.js';
import { fakeScreenPerCase } from './fake-screen.js';
import { stubAdapter } from './stub-adapter.js';

const SHEET = parseTestSpecTsv(
  [
    '#! md-business:test-spec-tsv/v1',
    'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
    '1\tメモを保存できる\t保存をタップする\t「保存しました」と表示される',
    '2\tメモを削除できる\t削除をタップする\t「保存しました」と表示される',
    '3\tメモを開ける\t開くをタップする\t「保存しました」と表示される',
    '',
  ].join('\n'),
);

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`待っても起きなかった: ${label}`);
}

/**
 * **頼まれたケースだけを走らせる**（C112・外から起動する口のため）。
 *
 * 画面から始める道は実行器を直接は呼ばず、ここを通る。**ここで落とすと、入口で受け取った
 * 指定が黙って消える**ので、通ることを 1 本で見る。
 */
describe('startRunSession — 頼まれたケースだけ', () => {
  it('No. 2 だけを頼むと、最初の打鍵待ちが 2 で、置いたら走り切る', async () => {
    const bridge = fakeBridge();
    const session = await startRunSession({
      afterActionMs: 0,
      adapter: stubAdapter({}),
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20261106-100000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
      expectation: { waitMs: 0, stepMs: 1 },
      only: [2],
    });

    await waitFor(() => bridge.states.at(-1)?.awaiting === 2, '2 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 2, humanResult: 'VERIFIED' });
    const run = await session.done;
    await session.close();

    expect(run.cases.map((c) => c.no)).toEqual([2]);
    expect(run.finishedAt).toBeDefined();
  });
});
