import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type ExecuteRunOptions,
  type SheetRef,
  createFakeAdapter,
  executeRun,
  parseTestSpecTsv,
} from '../../src/index.js';

/**
 * **指定したケースだけを走らせる**（2026-11-06・外から起動する口のため）。
 *
 * 漏れを並べる側の道具（tadori）が「このケースを確かめてくれ」と git-qa を呼ぶ。
 * シート全部を走らせると、人はそのケースに着くまで他のケースに判定を置き続けることになる。
 *
 * 決めたことは 2 つ。
 *
 * 1. **走らせなかったケースは、証跡に書かない**（続きからと同じ約束・2026-09-12）。
 *    「頼まれなかったので SKIP」と書くと、走らせた末に見送ったケースと見分けが付かない
 * 2. **走り切ったら終わりの時刻を押す。**頼まれた分を走り切ったので、その実行は終わっている。
 *    呼んだ側は `finishedAt` の有無で終わりを知る
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
  runId: '20261106-090000',
  sheet: parseTestSpecTsv(SHEET_TEXT),
  sheetRef: sheetRef(),
  adapter: createFakeAdapter({ recording: { requested: false } }),
  operator: { handle: 'octocat' },
  mode: 'auto',
  runCase: () => Promise.resolve({ aiResult: 'PASS' as const }),
  ...overrides,
});

describe('executeRun — 指定したケースだけ', () => {
  it('頼まれたケースだけを走らせ、ほかは証跡に書かない', async () => {
    const ran: number[] = [];

    const run = await executeRun(
      options({
        only: [2],
        runCase: (ctx) => {
          ran.push(ctx.subject.no);
          return Promise.resolve({ aiResult: 'PASS' as const });
        },
      }),
    );

    expect(ran).toEqual([2]);
    expect(run.cases.map((c) => c.no)).toEqual([2]);
  });

  /** 頼まれた分を走り切ったので、その実行は終わっている。 */
  it('走り切ったら、終わりの時刻が付く', async () => {
    const run = await executeRun(options({ only: [3] }));

    expect(run.cases.map((c) => c.no)).toEqual([3]);
    expect(run.finishedAt).toBeDefined();
  });

  /** 2 つ以上頼まれたら、シートの順で走る（頼まれた順ではない）。 */
  it('複数ならシートの順で走る', async () => {
    const run = await executeRun(options({ only: [3, 1] }));

    expect(run.cases.map((c) => c.no)).toEqual([1, 3]);
  });

  /** **繋ぐ前に止める。**無い No. を頼まれて、相手を触った跡だけ残さない。 */
  it('シートに無い No. を頼まれたら、繋ぐ前に落ちる', async () => {
    let connected = false;
    const adapter = createFakeAdapter({ recording: { requested: false } });
    const watched = {
      ...adapter,
      connect: () => {
        connected = true;
        return adapter.connect();
      },
    };

    await expect(executeRun(options({ adapter: watched, only: [9] }))).rejects.toThrow(/No\. 9/);
    expect(connected).toBe(false);
  });

  /** 空で渡されたら「全部」ではなく「何も頼まれていない」—— 黙って全部走らせない。 */
  it('空の指定は受け取らない', async () => {
    await expect(executeRun(options({ only: [] }))).rejects.toThrow(/No\./);
  });
});
