import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type ExecuteRunOptions,
  type SheetRef,
  createFakeAdapter,
  executeRun,
  parseTestSpecTsv,
} from '../../src/index.js';

/**
 * **走り切っていない証跡を、走り切ったように見せない。**
 *
 * `run.json` の `finishedAt` は「**無いことが『途中で止まった』の記録になる**」という
 * 約束で作ってある（`types.ts`）。
 *
 * ところが 2026-09-11 に入れた「1 件終わるたびに書く」（外部レビュー #2）が、
 * **途中経過にも `finishedAt` を押していた。**
 * 落ちた実行の証跡を翌日に開いても、**走り切ったものと見分けが付かない。**
 *
 * 証跡が残ること自体は #2 で直った。**残った証跡が何なのかが読めること**は、別の話。
 */

const SHEET_TEXT = [
  '#! md-business:test-spec-tsv/v1',
  '# タイトル: サンプル 検証シート',
  'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
  '1\t起動する\t1. 開く\tホーム画面が出る',
  '2\t保存できる\t1. 保存する\t一覧に出る',
].join('\r\n');

const sheetRef = (): SheetRef => ({
  path: 'docs/test-specs/001.tsv',
  sha256: createHash('sha256').update(SHEET_TEXT).digest('hex'),
});

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'git-qa-partial-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const options = (overrides: Partial<ExecuteRunOptions> = {}): ExecuteRunOptions => ({
  runId: '20260912-090000',
  sheet: parseTestSpecTsv(SHEET_TEXT),
  sheetRef: sheetRef(),
  adapter: createFakeAdapter({ recording: { requested: false } }),
  operator: { handle: 'octocat' },
  mode: 'auto',
  runsRoot: root,
  runCase: () => Promise.resolve({ aiResult: 'PASS' as const }),
  ...overrides,
});

const readRun = async (): Promise<{ finishedAt?: string; cases: readonly unknown[] }> =>
  JSON.parse(await readFile(join(root, '20260912-090000', 'run.json'), 'utf8')) as {
    finishedAt?: string;
    cases: readonly unknown[];
  };

describe('executeRun — 途中の証跡と、走り切った証跡', () => {
  /** **途中経過には終わりの時刻を押さない。**押すと、落ちた実行が完走に見える。 */
  it('1 件目を終えた時点の証跡には、終わりの時刻が無い', async () => {
    let seen: { finishedAt?: string; cases: readonly unknown[] } | undefined;

    await executeRun(
      options({
        runCase: async () => {
          // 2 件目を走らせる前に、1 件目の途中経過を読む。
          if (seen === undefined) {
            seen = await readRun().catch(() => undefined);
          }
          return { aiResult: 'PASS' as const };
        },
      }),
    );

    // 1 件目の実行中はまだ書かれていない。2 件目の頭で読めるのが「1 件目まで」の証跡。
    expect(seen?.cases).toHaveLength(1);
    expect(seen?.finishedAt).toBeUndefined();
  });

  /** **走り切ったものには押す。**そこが「終わった」の印。 */
  it('走り切った証跡には、終わりの時刻がある', async () => {
    const run = await executeRun(options());

    expect(run.finishedAt).toBeDefined();
    expect((await readRun()).finishedAt).toBeDefined();
  });
});
