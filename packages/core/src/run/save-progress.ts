import { writeBackToSheet } from './fill-sheet.js';
import { mkdir, rename, writeFile } from 'node:fs/promises';

import { runDir, runJsonPath } from './layout.js';
import type { Run } from './types.js';
import { validateRun } from './validate.js';

/**
 * 途中経過の証跡を書く（外部レビュー meta-taro/git-qa#2 の提案 2）。
 *
 * > 判定を置くたびに書く。落ちた実行の証跡は「途中まで」であって「無」ではないので
 *
 * **提案 1（signal を拾う）だけでは足りない。**
 *
 * 2026-09-11 には「`vite-node` の下では signal が来ない」と書いていたが、
 * **2026-09-14 に測り直したら届いていた。**当時の測り方が悪かったのか、
 * 道具が変わったのかは分からない。
 *
 * それでも**これは要る。**signal を拾う道が救えるのは「拾える落ち方」だけで、
 * `SIGKILL`・電源・親ごと消える、は救えない。
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

  /**
   * **正本のシートへ書き戻す**（2026-09-24・人の判断・C3 を覆した）。
   *
   * > だれがいつどう検査したか正本が更新されないなら、なにが便利なんですか？
   *
   * **ここに置いたのは、合流点だから。**実行の入口は 9 か所あり、
   * **1 か所ずつ足すと、足し忘れた道でだけ書かれない**（#37 で実際に踏んだ）。
   *
   * **落ちない。**書けなくても証跡は既に書き終わっている。
   * **書けなかったことは、呼び側が言う**（`writeBackToSheet` が理由を返す）。
   */
  await writeBackToSheet(run).catch(() => undefined);
  return path;
}
