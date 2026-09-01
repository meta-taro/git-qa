/**
 * 3 カラムの構成をここに閉じる。
 *
 * 中央はライブビュー（PRD §2 / C4）。**この製品の主媒体はここ**で、
 * 人はここを見て `VERIFIED` を置く。左右はそれを挟む付随物という位置づけ。
 */

export type ColumnId = 'cases' | 'live' | 'verdict';

export interface Column {
  readonly id: ColumnId;
  readonly heading: string;
  /** 中身がまだ無いときに枠へ出す文言。骨格の時点では全カラムが空。 */
  readonly placeholder: string;
  /** 横幅の取り分。CSS 側へ `--column-flex` として渡す。 */
  readonly flex: number;
}

export const COLUMNS: readonly Column[] = [
  {
    id: 'cases',
    heading: 'ケース',
    placeholder: '検証シートを読み込むと、ここにケースが並ぶ',
    flex: 1,
  },
  {
    id: 'live',
    heading: 'ライブビュー',
    placeholder: '接続すると、ここに検証中の画面が出る',
    flex: 3,
  },
  {
    id: 'verdict',
    heading: '判定',
    placeholder: '実行を始めると、ここに判定と証跡が出る',
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
