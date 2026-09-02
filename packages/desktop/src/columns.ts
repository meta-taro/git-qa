import type { MessageKey } from './i18n/index.js';

/**
 * 3 カラムの構成をここに閉じる。
 *
 * 中央はライブビュー（PRD §2 / C4）。**この製品の主媒体はここ**で、
 * 人はここを見て `VERIFIED` を置く。左右はそれを挟む付随物という位置づけ。
 */

export type ColumnId = 'cases' | 'live' | 'verdict';

export interface Column {
  readonly id: ColumnId;
  /** 文言そのものではなく鍵を持つ。**画面のコードに文字列を書かない**（Issue 011）。 */
  readonly headingKey: MessageKey;
  /** 中身がまだ無いときに枠へ出す文言の鍵。 */
  readonly placeholderKey: MessageKey;
  /** 横幅の取り分。CSS 側へ `--column-flex` として渡す。 */
  readonly flex: number;
}

export const COLUMNS: readonly Column[] = [
  {
    id: 'cases',
    headingKey: 'column.cases.heading',
    placeholderKey: 'column.cases.placeholder',
    flex: 1,
  },
  {
    id: 'live',
    headingKey: 'column.live.heading',
    placeholderKey: 'column.live.placeholder',
    flex: 3,
  },
  {
    id: 'verdict',
    headingKey: 'column.verdict.heading',
    placeholderKey: 'column.verdict.placeholder',
    flex: 1,
  },
];

/** 主媒体のカラム。左右のどちらかが中央より広くなる変更を、呼び出し側から検出できるようにする。 */
export const MAIN_COLUMN_ID: ColumnId = 'live';

export function mainColumn(columns: readonly Column[] = COLUMNS): Column {
  const found = columns.find((column) => column.id === MAIN_COLUMN_ID);
  if (!found) {
    throw new Error(`主媒体のカラム ${MAIN_COLUMN_ID} が構成に無い`);
  }
  return found;
}
