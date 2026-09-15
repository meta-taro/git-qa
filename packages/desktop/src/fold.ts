import { MAIN_COLUMN_ID } from './columns.js';
import { t } from './i18n/current.js';
import { readSetting, writeSetting } from './setting-store.js';
import type { ColumnId } from './columns.js';
import type { SettingStore } from './setting-store.js';

/**
 * **脇を畳んで、映像に幅を返す**（外部レビュー meta-taro/git-qa#17）。
 *
 * > 相手の窓 1280px / 映像の枠 803px / 表示倍率 **63%**
 * > **この時点で画素の 3 分の 1 以上が捨てられていて、あとからいくら拡大しても戻りません。**
 *
 * 横を食っていたのは**常設の脇**（ケース一覧 約 250px ＋ 判定パネル 約 260px）。
 * 返せば 63% → 約 82%。**拡大より効く** —— 補間ではなく、**本物の画素が増える。**
 *
 * **中央は畳めない。**人が見て判定を置く所（C4）が消せると、この道具の値打ちが消える。
 * **畳んでも開く口は残す。**戻せない畳み方をしない。
 */

const KEY = 'git-qa.folded';

/** 畳める所か。**主媒体は畳めない。** */
const foldable = (id: ColumnId): boolean => id !== MAIN_COLUMN_ID;

const columnIn = (root: HTMLElement, id: ColumnId): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-column-id="${id}"]`);

export function isFolded(root: HTMLElement, id: ColumnId): boolean {
  return columnIn(root, id)?.classList.contains('is-folded') === true;
}

export function foldColumn(root: HTMLElement, id: ColumnId, folded: boolean): void {
  if (!foldable(id)) return;
  const column = columnIn(root, id);
  if (column === null) return;

  column.classList.toggle('is-folded', folded);
  const button = column.querySelector('.column-fold');
  button?.setAttribute('aria-expanded', folded ? 'false' : 'true');
  button?.setAttribute('title', t(folded ? 'column.unfold' : 'column.fold'));
}

/** 覚えてある畳み方。**読めない機械では、畳まない所から始める。** */
function remembered(store: SettingStore | undefined): ColumnId[] {
  const said = readSetting(KEY, store);
  if (said === undefined || said === '') return [];
  return said.split(',').filter((id): id is ColumnId => id === 'cases' || id === 'verdict');
}

/**
 * 畳む口を付ける。**押した結果は覚える**（毎回畳み直させない）。
 *
 * `onChange` は、**幅が変わったことを外へ知らせる**ための口。
 * 矢印は枠の大きさから位置を出すので、畳んだら指し直しが要る（#15）。
 */
export function installFolding(
  root: HTMLElement,
  store: SettingStore | undefined,
  onChange?: () => void,
): void {
  const folded = new Set<ColumnId>(remembered(store));

  for (const id of ['cases', 'verdict'] as const) {
    const column = columnIn(root, id);
    if (column === null) continue;

    const button = root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'column-fold';
    // **記号だけにしない。**読み上げと、押す前の意味が分かるように名前を持たせる。
    button.setAttribute('aria-label', t('column.fold'));
    button.addEventListener('click', () => {
      const next = !isFolded(root, id);
      foldColumn(root, id, next);
      if (next) folded.add(id);
      else folded.delete(id);
      writeSetting(KEY, [...folded].join(','), store);
      onChange?.();
    });

    column.querySelector('.column-heading')?.append(button);
    foldColumn(root, id, folded.has(id));
  }
}
