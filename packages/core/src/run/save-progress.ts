import { mkdir, rename, writeFile } from 'node:fs/promises';

import { runDir, runJsonPath } from './layout.js';
import type { Run } from './types.js';
import { validateRun } from './validate.js';

/**
 * 途中経過の証跡を書く（外部レビュー meta-taro/git-qa#2 の提案 2）。
 *
 * > 判定を置くたびに書く。落ちた実行の証跡は「途中まで」であって「無」ではないので
 *
 * **提案 1（signal を拾う）は、この道具では効かない。**
 * CLI は `vite-node` の下で走り、**signal がスクリプトまで来ない**（2026-09-11 実測。
 * `prependListener` でも、同期でファイルに書いても、1 度も動かなかった）。
 * つまり `app-cli` にある「正しい形」も、実は動いていない。
 * **落ち方を選ばない方法は、これしかない。**
 *
 * `writeRunJson` との違いは 2 つ。
 *
 * - **同じ実行なら上書きする。**途中経過なので、最後の 1 回が残ればよい
 * - **書き換えの途中を残さない。**別名で書いてから置き換える。
 *   落ちたのが書いている最中でも、**半分だけの JSON は残らない**
 *
 * **緩めないところ**: 壊れた形は書かない。読めない証跡は、無い証跡より悪い。
 */
export async function saveRunProgress(runsRoot: string, run: Run): Promise<string> {
  const result = validateRun(run);
  if (!result.valid) {
    throw new Error(`run.json として書けない形になっている:\n${result.errors.join('\n')}`);
  }

  const path = runJsonPath(runsRoot, run.runId);
  await mkdir(runDir(runsRoot, run.runId), { recursive: true });

  // 同じフォルダへ置いてから rename する（別の器だと rename が使えない）。
  const staging = `${path}.writing`;
  await writeFile(staging, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  await rename(staging, path);
  return path;
}
