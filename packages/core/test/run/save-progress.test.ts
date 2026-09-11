import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { saveRunProgress } from '../../src/run/save-progress.js';
import { validRun } from '../../src/testing/fixtures.js';

/**
 * **途中経過を書く**（外部レビュー meta-taro/git-qa#2 の提案 2）。
 *
 * > 判定を置くたびに書く。落ちた実行の証跡は「途中まで」であって「無」ではないので
 *
 * 提案 1（signal を拾う）は**この道具では効かない**ことが分かった。
 * CLI は `vite-node` の下で走り、**signal がスクリプトまで来ない**（実測。
 * `prependListener` でも、同期でファイルに書いても、1 度も動かなかった）。
 * つまり `app-cli` にある「正しい形」も、実は動いていない。
 *
 * **落ち方を選ばない方法は、これしかない。**
 */
const made: string[] = [];
const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'git-qa-progress-'));
  made.push(dir);
  return dir;
};
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('saveRunProgress', () => {
  it('書いた場所を返す', async () => {
    const root = await tempDir();
    const run = validRun();

    const path = await saveRunProgress(root, run);

    expect(path).toBe(join(root, run.runId, 'run.json'));
    const written = JSON.parse(await readFile(path, 'utf8')) as { runId: string };
    expect(written.runId).toBe(run.runId);
  });

  /**
   * **同じ実行なら、何度でも上書きする。**
   * 途中経過なので、最後の 1 回が残ればよい。
   */
  it('同じ実行を 2 度書いても落ちない（上書きする）', async () => {
    const root = await tempDir();
    const run = validRun();

    await saveRunProgress(root, run);
    const path = await saveRunProgress(root, { ...run, cases: [] });

    const written = JSON.parse(await readFile(path, 'utf8')) as { cases: unknown[] };
    expect(written.cases).toEqual([]);
  });

  /**
   * **壊れた形は書かない。**
   * 途中経過だからといって緩めると、**読めない証跡が残る**（それは無いより悪い）。
   */
  it('schema を通らないものは書かない', async () => {
    const root = await tempDir();
    const broken = { ...validRun(), runId: '' };

    await expect(saveRunProgress(root, broken)).rejects.toThrow();
  });
});
