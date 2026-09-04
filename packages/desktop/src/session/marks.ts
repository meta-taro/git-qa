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
