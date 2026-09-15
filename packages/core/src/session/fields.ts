import type { TsvRow } from '../tsv/types.js';
import type { SessionField } from './protocol.js';

/**
 * **判定する人が読むものを、シートから作る**（外部レビュー meta-taro/git-qa#19）。
 *
 * > 署名する人が、何を確かめているのか画面から読めない。そうなると置かれる
 * > `VERIFIED` は、「AI がそう言っているから」に近づきます。
 *
 * **列名を決め打ちしない。**`No.` は識別子、`項目` は見出しとして別に出ているので外し、
 * **残りは書いた人の言葉のまま、並び順のまま**運ぶ。決め打ちにすると、
 * 書き手が足した「なぜ見るのか」のような列が届かない。
 */
/**
 * 別に出ている列。**ここから読み込まずに書いてある。**
 *
 * `run/execute.ts` の `CASE_NO_COLUMN` / `CASE_TITLE_COLUMN` と同じ値だが、
 * **そちらは Node 専用の口を引き込む**（画面の束に `node:fs` が混ざる）。
 * `session/` はブラウザでも読める所なので、持ち込まない。
 * **食い違わないことは検査で縛ってある**（`fields.test.ts`）。
 */
const SKIP: readonly string[] = ['No.', '項目'];

export function caseFields(row: TsvRow, columns: readonly string[]): SessionField[] {
  const fields: SessionField[] = [];
  for (const label of columns) {
    if (SKIP.includes(label)) continue;
    const value = row.cells[label];
    // **空欄は出さない。**読む人の役に立たないうえ、大事な行を下へ押す。
    if (value === undefined || value.trim() === '') continue;
    fields.push({ label, value });
  }
  return fields;
}
