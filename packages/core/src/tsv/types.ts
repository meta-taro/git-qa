/**
 * 検証シート TSV（md-business `test-spec-tsv/v1`）の読み取り結果の型。
 *
 * git-qa はこの形式を **読むだけ**で、書き戻さない（decisions.md C3）。
 * 書式の正本は md-business 側にあるので、こちらは知らないものを捨てずに raw で持つ。
 */

/** 列に付いた型注釈。`名前:型!` の「型」部分。 */
export type TsvColumnType =
  | { kind: 'text' }
  | { kind: 'number' }
  | { kind: 'date' }
  | { kind: 'url' }
  | { kind: 'multiline' }
  | { kind: 'enum'; values: string[] };

export interface TsvColumn {
  /** `結果:enum(OK|NG|保留|未実施)!` の `結果` */
  name: string;
  type: TsvColumnType;
  /** 末尾に `!` が付いていたか（必須列） */
  required: boolean;
  /** 列定義の原文 */
  raw: string;
  /** 0 始まりの列位置 */
  index: number;
}

/** `#@ <種別> <値>` の宣言行。種別を解釈できなくても捨てない。 */
export interface TsvDirective {
  kind: string;
  value: string;
  raw: string;
  line: number;
}

export interface TsvRow {
  /** 0 始まりのデータ行番号 */
  index: number;
  /** 1 始まりの物理行番号。エラー報告と md-business への突き合わせに使う */
  line: number;
  /** 列名 → 値。multiline 列は `\n` を実改行へ戻してある */
  cells: Record<string, string>;
  /** 列名 → 原文の値（復元前） */
  rawCells: Record<string, string>;
  /** 行の原文 */
  raw: string;
}

export interface TestSpecSheet {
  /** `#!` の後ろ。例: `md-business:test-spec-tsv/v1` */
  magic: string;
  /** `# キー: 値` の見出し */
  meta: Record<string, string>;
  directives: TsvDirective[];
  columns: TsvColumn[];
  rows: TsvRow[];
}
