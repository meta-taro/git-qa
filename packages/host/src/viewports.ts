import { parseViewports, sheetViewports, viewportLabel, type Viewport } from '@git-qa/core';

import { flagValue } from './argv.js';

/**
 * **ページの表示領域の大きさを、シートか引数で決める**（2026-11-26・C122）。
 *
 * シートの `# 画面:` が基本（証跡の `sha256` から復元できる・C40）。
 * `--viewport 390x844,1440x900` は**同じシートを CI で複数の幅に当てる**ための口で、
 * 渡されればシートより優先する。渡した大きさは証跡の `target.viewport` に残るので、
 * 引数で決めても「どの幅で見たか」は失われない。
 *
 * どちらも無ければ `undefined` —— **既存のシートは 1 文字も変えずに、今までどおりの窓で動く。**
 */
export const VIEWPORT_FLAG = '--viewport';

export function resolveViewports(
  argv: readonly string[],
  meta: Record<string, string>,
): Viewport[] | undefined {
  const flag = flagValue(argv, VIEWPORT_FLAG);
  if (flag.present) {
    if (flag.value === undefined) {
      throw new Error(
        `${VIEWPORT_FLAG} に大きさが無い。${VIEWPORT_FLAG} 390x844 か ${VIEWPORT_FLAG}=390x844,1440x900 と書く`,
      );
    }
    return parseViewports(flag.value);
  }
  return sheetViewports(meta);
}

/**
 * **幅ごとに証跡を分ける。**1 本の `run.json` は 1 つの大きさで見たもの。
 * 複数の幅を回すときだけ、run の名前に大きさを添える（1 つなら今までどおり）。
 */
export function runIdFor(base: string, viewport: Viewport | undefined, count: number): string {
  if (viewport === undefined || count <= 1) return base;
  return `${base}-${viewportLabel(viewport)}`;
}

/**
 * 無人で複数の幅を回したときの終了コード（`headlessExitCode` と同じ語彙）。
 * **1 つでも落ちていれば 1。**落ちていないが人が見ないと決まらない幅があれば 2。
 * 何も回していなければ 2 —— 見るものが無いのは「通った」ではない。
 */
export function combineExitCodes(codes: readonly number[]): number {
  if (codes.length === 0) return 2;
  if (codes.includes(1)) return 1;
  if (codes.includes(2)) return 2;
  return 0;
}
