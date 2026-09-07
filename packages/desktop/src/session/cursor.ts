import type { HumanInput, SessionCase, SessionPhase } from '@git-qa/core/session';

import type { KeyCommand } from './keys.js';

/**
 * 「いま見ているケース」の動かし方と、打鍵の宛先。
 *
 * **押した判定が別のケースに付くのが一番まずい**ので、ここを検査で固める。
 */

/**
 * 前後に動かす。**走り終わったケースの中だけ**を行き来する
 * （まだ走っていないケースは、AI が操作していないので見て判断する材料が無い）。
 */
export function nextCursor(
  cases: readonly SessionCase[],
  cursor: number | undefined,
  awaiting: number | undefined,
  step: -1 | 1,
): number | undefined {
  const visitable = cases.filter((c) => c.aiResult !== undefined).map((c) => c.no);
  if (visitable.length === 0) return undefined;

  const from = cursor ?? awaiting ?? visitable[0];
  const at = from === undefined ? 0 : visitable.indexOf(from);
  const index = Math.min(Math.max((at === -1 ? 0 : at) + step, 0), visitable.length - 1);
  return visitable[index];
}

/**
 * 打鍵を、送る形へ直す。**見ているケースへ置く。**
 * 移動の指示（前後）は画面の中の話なので、ここでは送らない。
 */
export function humanInputFor(
  command: KeyCommand,
  caseNo: number | undefined,
): HumanInput | undefined {
  if (caseNo === undefined) return undefined;
  if (command.kind === 'advance') return { kind: 'advance', caseNo };
  if (command.kind === 'verdict') {
    return { kind: 'verdict', caseNo, humanResult: command.humanResult };
  }
  return undefined;
}

/**
 * 置けない理由。**置けるなら `undefined`。**
 *
 * 打鍵を送った瞬間に記号を光らせていたが、**受け取られたかは見ていなかった**
 * （2026-09-07）。実行器はまだ走っていないケースへの判定を捨てるので、
 * **置いていないのに置いた合図だけが出ていた。**黙って捨てるより悪い。
 */
export function whyCannotPlace(
  cases: readonly SessionCase[],
  caseNo: number | undefined,
  phase: SessionPhase,
): string | undefined {
  if (phase === 'finished') return 'この検証は終わっている。証跡はもう書かれた';
  if (caseNo === undefined) return 'どのケースへ置くかが決まっていない';

  const subject = cases.find((c) => c.no === caseNo);
  if (subject === undefined) return `そのケースがこのシートに無い（${String(caseNo)}）`;
  // 走っていなければ置けない。`aiResult` がその印。
  if (subject.aiResult === undefined) {
    return 'このケースはまだ走っていない。AI が操作していないので、見て判断する材料が無い';
  }
  return undefined;
}
