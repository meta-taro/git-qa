import { mkdir, writeFile } from 'node:fs/promises';

import { runDir, runJsonPath } from './layout.js';
import type { Run } from './types.js';
import { validateRun } from './validate.js';

/**
 * `runs/<runId>/run.json` を書く。**書く前に必ずスキーマへ通す。**
 *
 * 壊れた証跡は、無い証跡より始末が悪い。読めないファイルが 1 本残るだけで、
 * 「そのとき何を確かめたのか」が二度と分からなくなる。
 */
export async function writeRunJson(runsRoot: string, run: Run): Promise<string> {
  const result = validateRun(run);
  if (!result.valid) {
    throw new Error(`run.json として書けない形になっている:\n${result.errors.join('\n')}`);
  }

  const path = runJsonPath(runsRoot, run.runId);
  await mkdir(runDir(runsRoot, run.runId), { recursive: true });
  try {
    // 上書きしない。同じ runId で 2 度書くのは、前の実行を黙って消すのと同じ。
    await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`既にある実行を上書きしようとした: ${path}`);
    }
    throw error;
  }
  return path;
}
