import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type ExecuteRunOptions,
  type SheetRef,
  type TargetSession,
  type TestSpecSheet,
  createFakeAdapter,
  executeRun,
  parseTestSpecTsv,
  validateRun,
} from '../../src/index.js';

/**
 * **走行中に相手が入れ替わっていないか**を証跡に残す（外部レビュー meta-taro/git-qa#3）。
 *
 * > シートは同一性を持っているのに、検証対象は持っていません。
 * > 前半 5 件は旧ビルド、後半 5 件は新ビルド、という証跡を作ります。
 *
 * **止めない。**読めれば足りる。
 */

const SHEET_TEXT = [
  '#! md-business:test-spec-tsv/v1',
  '# タイトル: サンプルメモ帳アプリ 検証シート',
  '# 文書番号: TEST-git-qa-001',
  'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
  '1\tアプリが起動する\t1. 開く\tホーム画面が出る',
  '2\tメモを保存できる\t1. 保存する\t一覧に出る',
].join('\r\n');

const sheet = (): TestSpecSheet => parseTestSpecTsv(SHEET_TEXT);

const sheetRef = (): SheetRef => ({
  path: 'docs/test-specs/001-sample-notes-app.tsv',
  sha256: createHash('sha256').update(SHEET_TEXT).digest('hex'),
  title: 'サンプルメモ帳アプリ 検証シート',
});

const tickingClock = (): (() => Date) => {
  let ms = Date.parse('2026-09-11T10:00:00.000Z');
  return () => {
    ms += 1000;
    return new Date(ms);
  };
};

const options = (overrides: Partial<ExecuteRunOptions> = {}): ExecuteRunOptions => ({
  runId: '20260911-190000',
  sheet: sheet(),
  sheetRef: sheetRef(),
  operator: { handle: 'octocat' },
  mode: 'auto',
  now: tickingClock(),
  runCase: () => Promise.resolve({ aiResult: 'PASS' as const }),
  ...overrides,
});

/** 指紋を返す相手。**呼ばれるたびに次の 1 本**を返す（途中で変わる相手を作る）。 */
const sessionReturning = async (prints: (string | undefined)[]): Promise<TargetSession> => {
  const session = await createFakeAdapter({ recording: { requested: false } }).connect();
  let index = 0;
  return {
    ...session,
    get isClosed() {
      return session.isClosed;
    },
    act: (action) => session.act(action),
    observe: () => session.observe(),
    screenshot: () => session.screenshot(),
    close: () => session.close(),
    fingerprint: () => {
      const print = prints[Math.min(index, prints.length - 1)];
      index += 1;
      return Promise.resolve(print);
    },
  };
};

describe('executeRun — 相手が走行中に変わったかを残す', () => {
  it('同じままなら same', async () => {
    const session = await sessionReturning(['/A\t100\t2026-09-11T09:00:00.000Z']);

    const run = await executeRun(options({ session }));

    expect(run.targetCheck).toEqual({
      state: 'same',
      before: '/A\t100\t2026-09-11T09:00:00.000Z',
      after: '/A\t100\t2026-09-11T09:00:00.000Z',
    });
  });

  it('途中で入れ替わったら changed（止めずに、残す）', async () => {
    const session = await sessionReturning(['/A\t100\tt1', '/A\t101\tt2']);

    const run = await executeRun(options({ session }));

    expect(run.targetCheck?.state).toBe('changed');
    // **走り切る。**変わったことは証跡であって、実行を止める理由ではない。
    expect(run.cases).toHaveLength(2);
  });

  /** **測る口を持たない相手を「変わっていない」と書かない。**無い保証があるように読める。 */
  it('口を持たない相手は unmeasurable', async () => {
    const run = await executeRun(
      options({ adapter: createFakeAdapter({ recording: { requested: false } }) }),
    );

    expect(run.targetCheck).toEqual({
      state: 'unmeasurable',
      reason: 'この相手は、同じものかどうかを測る口を持っていない',
    });
  });

  /** 測れなくなった（相手が居なくなった）ことも、そう書く。 */
  it('後から測れなくなったら unmeasurable', async () => {
    const session = await sessionReturning(['/A\t100\tt1', undefined]);

    const run = await executeRun(options({ session }));

    expect(run.targetCheck?.state).toBe('unmeasurable');
  });

  it('run.json の形として通る', async () => {
    const session = await sessionReturning(['/A\t100\tt1', '/A\t101\tt2']);

    const run = await executeRun(options({ session }));

    expect(validateRun(run)).toEqual({ valid: true, errors: [] });
  });
});
