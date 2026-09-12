import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Run } from '@git-qa/core';

/**
 * **続きから走らせられる証跡を見つける**（2026-09-12・人の指示）。
 *
 * > それは途中までテストして、落として、次の日検証を再開しても大丈夫ですかね
 *
 * 目印は **`finishedAt` が無いこと。**「無いことが『途中で止まった』の記録になる」
 * という約束で作ってある（`types.ts`）。
 *
 * **読めないものは黙って捨てる。**壊れた 1 つで、他の候補まで見せられなくならない。
 * ただし**数だけは合わせる** —— 人が見て置いた件数は、選ぶときにいちばん知りたい所。
 */

export interface ResumableRun {
  readonly runId: string;
  /** 証跡に書かれていたシートの場所。**ワークスペースからの相対**のことがある。 */
  readonly sheetPath: string;
  readonly sheetSha256: string;
  readonly startedAt: string;
  /** 証跡に在るケース数（＝ここまで走らせた数）。 */
  readonly cases: number;
  /** そのうち、**人が見て置いた**数。`AUTO_PASS` は入らない。 */
  readonly placed: number;
}

/** **人が見て置いたもの。**`AUTO_PASS` と `SKIP` は入らない（人は見ていない）。 */
const PLACED_BY_HUMAN = new Set(['VERIFIED', 'FAIL', 'BLOCKED']);

export async function findUnfinishedRuns(runsRoot: string): Promise<ResumableRun[]> {
  // 置き場が無いのは普通のこと（まだ 1 度も走らせていない）。
  const names = await readdir(runsRoot).catch(() => [] as string[]);

  const found: ResumableRun[] = [];
  for (const name of names) {
    const run = await readRun(join(runsRoot, name, 'run.json'));
    if (run === undefined || run.finishedAt !== undefined) continue;

    found.push({
      runId: run.runId,
      sheetPath: run.sheet.path,
      sheetSha256: run.sheet.sha256,
      startedAt: run.startedAt,
      cases: run.cases.length,
      placed: run.cases.filter((one) => PLACED_BY_HUMAN.has(one.result)).length,
    });
  }

  // **新しいものが先。**人が探すのは、だいたい直前に止めたもの。
  return found.sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));
}

/** 証跡を 1 本読む。**読めなければ `undefined`**（形の検査はここではしない）。 */
export async function readRun(path: string): Promise<Run | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as Run;
  } catch {
    // 壊れた 1 つで、他の候補まで見せられなくならない。
    return undefined;
  }
}
