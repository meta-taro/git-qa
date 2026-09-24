import type { ExpectationCheck } from './steps.js';

/**
 * **押す前から画面に在る文字を、期待結果に書けてしまう**（2026-09-24・人の指示）。
 *
 * > この指摘をずっとしています。3 回以上。
 *
 * 期待結果は `「X」と表示される` だけで、**在るか、しか見ない。**
 * **押す前から在る文字を書くと、何も起きなくても通る。**
 *
 * **同じ日に、同じ相手が 3 回、同じ雑さでシートを書いた。**
 * 文書にも書いたが、**書いた本人が 3 回踏んだ** ——
 * **手順書は実行者が飛ばせる**（管理側の記録 `feedback-workflow-mechanize-over-document`）。
 * **機械で止める。**
 *
 * **押す前の画面にも在ったなら、その行は何も確かめていない。**
 * 通してはいけないし、**落第（FAIL）にもしない** —— 製品は悪くないので。
 * **判断保留（BLOCKED）にして、シートを直させる。**
 */

/**
 * その期待は、**押す前から満たされていたか**。
 *
 * **押す前の画面が読めなかったときは止めない** —— 読めないことを落第にしない（C20）。
 * **文字を見ない期待**（人が見るしかないもの）は、そもそもここへ来ない。
 */
export function wasAlreadyThere(
  expectation: ExpectationCheck,
  before: string | undefined,
): boolean {
  if (expectation.kind !== 'contains') return false;
  if (before === undefined) return false;
  return before.includes(expectation.text);
}

/** **何が起きたかと、どう直すかを言う。**「駄目です」だけだと、人はシートを眺めることになる。 */
export function alreadyThereMessage(text: string): string {
  return (
    `「${text}」は、**押す前から画面に在った。**` +
    'それでは、その手順で何が変わったのかを確かめていない（この道具は「在るか」しか見ない）。' +
    '**押したあとに出る文字**を期待結果にする。' +
    '例: ボタンの文字ではなく、押して初めて開く一覧の中の文字'
  );
}
