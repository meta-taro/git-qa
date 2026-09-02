import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseTestSpecTsv, validateRun, writeRunJson } from '@git-qa/core';
import type { Run } from '@git-qa/core';
import type { SessionState } from '@git-qa/core/session';

import { startRunSession } from '../src/index.js';
import { stubAdapter } from './stub-adapter.js';

/**
 * 一本道を、**本物の HTTP を通して**端から端まで走らせる。
 *
 * 部品が揃っていても繋がっていないことがある（実際にあった）。ここでは橋も打鍵も本物で、
 * 端末だけが代役。**確かめているのは「人が見た行と見ていない行が、証跡の上で区別できる」こと。**
 */

const SHEET = parseTestSpecTsv(
  [
    '#! md-business:test-spec-tsv/v1',
    '# タイトル: サンプルメモ帳アプリ 検証シート',
    'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
    '1\tメモを保存できる\t保存をタップする\t「保存しました」と表示される',
    '2\t一覧に出る\t一覧をタップする\t「保存しました」と表示される',
    '3\t消せる\t削除をタップする\t一覧からメモが消える',
    '4\t検索できる\t検索をタップする\t「見つかりません」と表示される',
    '5\t日本語を打てる\t本文に「あいうえお」と入力する\t「あいうえお」と表示される',
    '',
  ].join('\n'),
);

let runsRoot = '';
beforeEach(async () => {
  runsRoot = await mkdtemp(join(tmpdir(), 'git-qa-one-pass-'));
});
afterEach(async () => {
  await rm(runsRoot, { recursive: true, force: true });
});

/** 画面の代わりに、制御チャネルへ本物の HTTP で繋ぐ。 */
async function watch(controlUrl: string): Promise<{
  awaiting: (no: number) => Promise<void>;
  press: (input: unknown) => Promise<void>;
  last: () => SessionState | undefined;
  stop: () => Promise<void>;
}> {
  const res = await fetch(`${controlUrl}/events`);
  const body: ReadableStream<Uint8Array> | null = res.body;
  expect(body).not.toBeNull();
  const reader = body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let last: SessionState | undefined;

  void (async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      buffer += decoder.decode(next.value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (line !== undefined) last = JSON.parse(line.slice('data: '.length)) as SessionState;
      }
    }
  })();

  return {
    last: () => last,
    async awaiting(no: number) {
      for (let i = 0; i < 400; i += 1) {
        if (last?.awaiting === no) return;
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error(
        `${String(no)} 件目の打鍵待ちにならなかった（いま ${String(last?.awaiting)}）`,
      );
    },
    async press(input: unknown) {
      const posted = await fetch(`${controlUrl}/input`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      expect(posted.status).toBe(202);
    },
    async stop() {
      await reader.cancel();
    },
  };
}

describe('一本道（端末だけ代役・橋も打鍵も本物）', () => {
  it('5 ケースを通し、run.json に VERIFIED と AUTO_PASS が混ざって残る', async () => {
    const session = await startRunSession({
      adapter: stubAdapter({}),
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260902-153000',
      operator: { handle: 'octocat' },
      readScreenText: () => Promise.resolve('保存しました'),
    });
    const screen = await watch(session.controlUrl);

    // 1 件目は人が見て置く。2 件目は置かずに送る（AI が通していても AUTO_PASS のまま）。
    await screen.awaiting(1);
    await screen.press({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });
    await screen.awaiting(2);
    await screen.press({ kind: 'advance', caseNo: 2 });
    await screen.awaiting(3);
    await screen.press({ kind: 'verdict', caseNo: 3, humanResult: 'VERIFIED' });
    await screen.awaiting(4);
    await screen.press({ kind: 'verdict', caseNo: 4, humanResult: 'FAIL' });
    await screen.awaiting(5);
    await screen.press({ kind: 'advance', caseNo: 5 });

    const run = await session.done;
    await screen.stop();
    await session.close();

    expect(validateRun(run).valid).toBe(true);
    expect(run.cases.map((c) => c.result)).toEqual([
      'VERIFIED',
      'AUTO_PASS',
      'VERIFIED',
      'FAIL',
      'BLOCKED',
    ]);

    // **AI の判定と、人が置いた判定が、別の値として残っている**（C1 / C17）。
    expect(run.cases.map((c) => c.aiResult)).toEqual([
      'PASS',
      'PASS',
      'BLOCKED',
      'FAIL',
      'BLOCKED',
    ]);
    expect(run.cases.filter((c) => c.verifiedBy !== undefined)).toHaveLength(3);
    // AI は 1 件目と 2 件目を同じく通している。差は「人が見たかどうか」だけ。
    expect(run.cases[1]?.verifiedBy).toBeUndefined();

    // 5 件目は日本語を送れないので、AI は操作せず判断保留にしている。
    expect(run.cases[4]?.note).toContain('あいうえお');

    const path = await writeRunJson(runsRoot, run);
    const written = JSON.parse(await readFile(path, 'utf8')) as Run;
    expect(written.cases).toHaveLength(5);
  });

  it('画面には、AI の判定と根拠が出ている', async () => {
    const session = await startRunSession({
      adapter: stubAdapter({}),
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260902-153100',
      operator: { handle: 'octocat' },
      readScreenText: () => Promise.resolve('保存しました'),
    });
    const screen = await watch(session.controlUrl);

    await screen.awaiting(1);
    const state = screen.last();
    expect(state?.cases[0]?.aiResult).toBe('PASS');
    expect(state?.cases[0]?.note).toContain('保存しました');
    // 走っていないケースは、結果を持たない。**空欄は空欄のまま**（§19）。
    expect(state?.cases[1]?.aiResult).toBeUndefined();

    session.abort('検査の後始末');
    await session.done;
    await screen.stop();
    await session.close();
  });
});
