import { describe, expect, it } from 'vitest';

import { CASE_NO_COLUMN, CASE_TITLE_COLUMN } from '../../src/run/execute.js';
import { caseFields } from '../../src/session/fields.js';
import type { TsvRow } from '../../src/tsv/types.js';

/**
 * **判定する人が読むものを、シートから作る**（外部レビュー meta-taro/git-qa#19）。
 *
 * > 判定を置く人は「何をすればいいか」も「なぜそれを確かめるのか」も画面から読めません。
 * > 読めるのは **AI が自分の限界を説明した文**だけです。**順番が逆**だと思いました。
 *
 * **列名を決め打ちしない。**`No.` は識別子、`項目` は見出しとして別に出ているので外す。
 * 残りは**シートを書いた人の言葉のまま**、並び順のまま運ぶ。
 */
const rowOf = (cells: Record<string, string>): TsvRow => ({
  index: 0,
  line: 8,
  cells,
  rawCells: cells,
  raw: '',
});

describe('caseFields', () => {
  it('手順と期待結果を、列の並び順で返す', () => {
    const fields = caseFields(
      rowOf({ 'No.': '1', 項目: 'ボタン', 手順: '「実行」をクリックする', 期待結果: '表が出る' }),
      ['No.', '項目', '手順', '期待結果'],
    );

    expect(fields).toEqual([
      { label: '手順', value: '「実行」をクリックする' },
      { label: '期待結果', value: '表が出る' },
    ]);
  });

  /** **書き手が足した列も届く**（提案 3）。運ぶ側が列名を知っている必要は無い。 */
  it('知らない列も、そのまま運ぶ', () => {
    const fields = caseFields(
      rowOf({ 'No.': '1', 項目: 'ボタン', 手順: '押す', なぜ見るのか: '対照のため' }),
      ['No.', '項目', '手順', 'なぜ見るのか'],
    );

    expect(fields.map((f) => f.label)).toEqual(['手順', 'なぜ見るのか']);
  });

  /** 見出しと番号は別に出ている。**同じものを二度出さない。** */
  it('No. と 項目 は運ばない', () => {
    const fields = caseFields(rowOf({ 'No.': '1', 項目: 'ボタン' }), ['No.', '項目']);

    expect(fields).toEqual([]);
  });

  /**
   * **空欄は空欄のまま**（product-baseline §19）。ただし**画面には出さない** ——
   * 何も書いていない欄を出しても読む人の役に立たず、大事な行が下へ押される。
   */
  it('空の欄は出さない', () => {
    const fields = caseFields(rowOf({ 手順: '押す', 期待結果: '   ' }), ['手順', '期待結果']);

    expect(fields).toEqual([{ label: '手順', value: '押す' }]);
  });
});

/**
 * **同じ列名を 2 箇所に書いている**（`session/fields.ts` と `run/execute.ts`）。
 *
 * `session/` はブラウザでも読める所なので、**Node 専用の口を引き込む側から取り込めない**
 * （画面の束に `node:fs` が混ざり、建てられなくなる）。
 * **食い違ったら、この検査が落ちる。**
 */
describe('外す列は、実行器と同じもの', () => {
  it('No. と 項目 が、そのまま外れる', () => {
    const fields = caseFields(
      rowOf({ [CASE_NO_COLUMN]: '1', [CASE_TITLE_COLUMN]: '見出し', 手順: '押す' }),
      [CASE_NO_COLUMN, CASE_TITLE_COLUMN, '手順'],
    );

    expect(fields).toEqual([{ label: '手順', value: '押す' }]);
  });
});
