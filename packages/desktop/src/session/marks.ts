/**
 * 判定の記号。
 *
 * **色が付くのは「人が見たもの」だけ。**`AUTO_PASS`（AI が通しただけ）は無彩色にする。
 * 一覧を眺めただけで「人が見た所」と「AI が言っただけの所」が分かる —— C1 / C17 が見た目に出る。
 *
 * 丸＝判定を置いた／四角＝見送った。
 */
const MARKS: Readonly<Record<string, string>> = {
  VERIFIED: '🟢',
  FAIL: '🔴',
  BLOCKED: '🟡',
  AUTO_PASS: '⚪',
  SKIP: '⬜',
};

/** 判定の記号。**まだ確定していないもの・知らない値は空のまま**（product-baseline §19）。 */
export function markFor(result: string | undefined): string {
  if (result === undefined) return '';
  return MARKS[result] ?? '';
}

/**
 * **一覧の札**（2026-10-21・DESIGN.md「ケース一覧の札」）。
 *
 * 記号（🟢 など）の代わりに、**短い語を色付きの札で出す。**色だけに頼らず、語でも読める。
 * 人が見たもの（VRF / FAIL / BLK）と、AI が通しただけのもの（AUTO）は**別の語**になる（C1）。
 *
 * まだ結果が無いケースは、**いま打鍵を待っているか**で分ける（`NOW` / `···`）。
 */
const TAGS: Readonly<Record<string, string>> = {
  VERIFIED: 'VRF',
  FAIL: 'FAIL',
  BLOCKED: 'BLK',
  AUTO_PASS: 'AUTO',
  SKIP: 'SKIP',
};

export function tagFor(result: string | undefined, awaiting: boolean): string {
  if (result !== undefined) return TAGS[result] ?? '';
  return awaiting ? 'NOW' : '···';
}
