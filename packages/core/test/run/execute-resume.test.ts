import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type ExecuteRunOptions,
  type Run,
  type SheetRef,
  createFakeAdapter,
  executeRun,
  parseTestSpecTsv,
} from '../../src/index.js';

/**
 * **途中で止めて、次の日に続きから**（2026-09-12・人の指示）。
 *
 * > それは途中までテストして、落として、次の日検証を再開しても大丈夫ですかね
 *
 * 大丈夫ではなかった。証跡は残るが、**続きから走らせる口が無かった。**
 * 翌日に起動すると新しい実行として 1 件目から走り、
 * **昨日人が見て置いた分をもう一度置き直すことになる。**
 *
 * ここで決めたことは 2 つ。
 *
 * 1. **走らせなかったケースは、証跡に書かない。**「止めたので BLOCKED」と書くと、
 *    **走らせた末に判断保留になったケースと見分けが付かない。**
 *    続きから走らせるときに、どれをやり直すべきかが読めなくなる
 * 2. **続きは、同じ実行に足す。**新しい実行にすると証跡が 2 本に割れ、
 *    読む人が突き合わせることになる
 */

const SHEET_TEXT = [
  '#! md-business:test-spec-tsv/v1',
  '# タイトル: サンプル 検証シート',
  'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
  '1\t起動する\t1. 開く\tホーム画面が出る',
  '2\t保存できる\t1. 保存する\t一覧に出る',
  '3\t消せる\t1. 消す\t一覧から消える',
].join('\r\n');

const sheetRef = (): SheetRef => ({
  path: 'docs/001.tsv',
  sha256: createHash('sha256').update(SHEET_TEXT).digest('hex'),
});

const options = (overrides: Partial<ExecuteRunOptions> = {}): ExecuteRunOptions => ({
  runId: '20260912-090000',
  sheet: parseTestSpecTsv(SHEET_TEXT),
  sheetRef: sheetRef(),
  adapter: createFakeAdapter({ recording: { requested: false } }),
  operator: { handle: 'octocat' },
  mode: 'auto',
  runCase: () => Promise.resolve({ aiResult: 'PASS' as const }),
  ...overrides,
});

describe('executeRun — 途中で止める', () => {
  it('止めたら、そこから先のケースは証跡に書かない', async () => {
    let ran = 0;

    const run = await executeRun(
      options({
        // 1 件走ったら止める。
        stopped: () => ran >= 1,
        runCase: () => {
          ran += 1;
          return Promise.resolve({ aiResult: 'PASS' as const });
        },
      }),
    );

    expect(run.cases.map((c) => c.no)).toEqual([1]);
  });

  /** **止まった実行には、終わりの時刻を押さない。**それが「途中」の印。 */
  it('止めた実行は、終わっていないと分かる', async () => {
    const run = await executeRun(options({ stopped: () => true }));

    expect(run.cases).toEqual([]);
    expect(run.finishedAt).toBeUndefined();
  });

  /** 止めなければ、今までどおり最後まで。 */
  it('止めなければ、最後まで走って終わりの時刻が付く', async () => {
    const run = await executeRun(options());

    expect(run.cases.map((c) => c.no)).toEqual([1, 2, 3]);
    expect(run.finishedAt).toBeDefined();
  });
});

describe('executeRun — 続きから', () => {
  const yesterday = async (): Promise<Run> => {
    let ran = 0;
    return executeRun(
      options({
        stopped: () => ran >= 1,
        runCase: () => {
          ran += 1;
          return Promise.resolve({ aiResult: 'PASS' as const });
        },
      }),
    );
  };

  it('置いてあるケースは走らせず、残りだけ走らせる', async () => {
    const previous = await yesterday();
    const ranToday: number[] = [];

    const run = await executeRun(
      options({
        previous,
        runCase: (ctx) => {
          ranToday.push(ctx.subject.no);
          return Promise.resolve({ aiResult: 'PASS' as const });
        },
      }),
    );

    expect(ranToday).toEqual([2, 3]);
    expect(run.cases.map((c) => c.no)).toEqual([1, 2, 3]);
  });

  /** **昨日の判定を、そのまま持ち越す。**置き直させない。 */
  it('昨日の判定は、そのまま残る', async () => {
    const previous = await yesterday();
    const before = previous.cases[0];

    const run = await executeRun(options({ previous }));

    expect(run.cases[0]).toEqual(before);
  });

  /** **始まりは昨日。**続きだからといって、今日始めたことにしない。 */
  it('始めた時刻は、昨日のまま', async () => {
    const previous = await yesterday();

    const run = await executeRun(options({ previous }));

    expect(run.startedAt).toBe(previous.startedAt);
  });

  /** 残りを走り切れば、終わりの時刻が付く。 */
  it('残りを走り切れば、終わったことになる', async () => {
    const run = await executeRun(options({ previous: await yesterday() }));

    expect(run.finishedAt).toBeDefined();
  });
});
