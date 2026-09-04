import type { SetupState } from './client.js';

/**
 * 準備画面を描き直すかどうか。
 *
 * **打っている最中に描き直すと、入力欄が作り直されてフォーカスが飛ぶ。**
 * 2026-09-04、人がハンドルを打ち直していて「me まで打つとフォーカスが外れる」。
 * 描き直しの条件に `operator === ''` が入っていたため、空 → 1 文字目で条件が反転し、
 * 次の poll（1 秒）で画面ごと作り直されていた。
 *
 * **ハンドルは、この判断に入れない。**打った内容はその場で画面へ反映される
 * （`renderSetup` の `reflect`）ので、描き直す理由が無い。
 */
export function nextDrawing(
  state: SetupState,
  pickedSheet: string | undefined,
  lastDrawn: string,
  typing: boolean,
): string | undefined {
  // 打っている手を止めるほうが、1 秒古い一覧より高くつく。**次の tick で追いつく。**
  if (typing) return undefined;

  const shape = JSON.stringify([state, pickedSheet]);
  return shape === lastDrawn ? undefined : shape;
}

/** ハンドルの欄に手がかかっているか。 */
export function isTypingHandle(doc: Document): boolean {
  return doc.activeElement?.classList.contains('setup-operator') === true;
}
