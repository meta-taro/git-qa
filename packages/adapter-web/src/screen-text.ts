import { parseElementNames } from './find.js';
import type { TargetSession } from '@git-qa/core';

/**
 * 繋いだセッションから、**画面で読める文字**を取る。
 *
 * 期待結果（「〜と表示される」）との突き合わせに使う（`createSheetCaseRunner`）。
 * **生データの形を知っているのはアダプタだけ**なので、ここに置く（コアは解釈しない・C8）。
 *
 * **HTML から自分で剥がさない。**`<script>` の中身や `display: none` の文字まで
 * 「表示されている」ことになり、**通ってはいけないケースが通る。**
 * 検証の道具でいちばん高くつくのは、偽の合格。だからブラウザに聞いた結果を使う。
 */

/** ウェブの生データ。**DOM と、ブラウザが出した「読める文字」の両方を持つ。** */
export interface WebObservation {
  /** DOM そのまま。**共通の木へ潰さない**（C24）。 */
  readonly html: string;
  /** ブラウザが出した、人が読める文字（`innerText`）。 */
  readonly text: string;
}

const isWebObservation = (value: unknown): value is WebObservation =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { text?: unknown }).text === 'string';

export async function readWebScreenText(session: TargetSession): Promise<string> {
  const observation = await session.observe();
  if (!isWebObservation(observation.raw)) {
    // 握り潰さない。読めないまま空文字を返すと、期待結果が「無い」ことになり FAIL が積む。
    throw new Error('画面の生データに、ブラウザが出した「読める文字」が入っていない');
  }
  return observation.raw.text;
}

/**
 * **押せる名前を並べる**（2026-09-19・MCP 拡充）。
 *
 * `element_tap` は名前で押せるのに、**どんな名前が在るかを知る口が無かった。**
 *
 * **契約は 1 つ。ここに並んだものは、そのまま `element_tap` に渡せる。**
 * 集め方は `findElementScript` と同じ（`listElementsScript`）。
 */
export async function listWebElements(session: TargetSession): Promise<string[]> {
  const observation = await session.observe();
  const raw = observation.raw;
  if (typeof raw !== 'object' || raw === null) return [];
  return parseElementNames((raw as { elementNames?: unknown }).elementNames);
}
