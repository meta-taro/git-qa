import type { Column } from './columns.js';
import { COLUMNS } from './columns.js';
import { t } from './i18n/current.js';

/**
 * カラムの枠を DOM へ描く。
 *
 * 幅は CSS に数値を書かず、構成（`columns.ts`）から `--column-flex` で渡す。
 * 2 箇所に同じ数字を置くと、片方だけ直された状態に気づけない。
 */
export function renderColumns(root: HTMLElement, columns: readonly Column[] = COLUMNS): void {
  root.replaceChildren();

  for (const column of columns) {
    const section = root.ownerDocument.createElement('section');
    section.className = 'column';
    section.dataset['columnId'] = column.id;
    section.style.setProperty('--column-flex', String(column.flex));

    const heading = root.ownerDocument.createElement('h2');
    heading.className = 'column-heading';
    heading.textContent = t(column.headingKey);

    const placeholder = root.ownerDocument.createElement('p');
    placeholder.className = 'column-placeholder';
    placeholder.textContent = t(column.placeholderKey);

    section.append(heading, placeholder);
    root.append(section);
  }
}

/**
 * 言語が変わったときに、**文言だけ**差し替える。
 *
 * **描き直さない。**`renderColumns` は中身を作り直すので、
 * 言語を切り替えた拍子に、見ている映像（canvas）が消えてしまう。
 */
export function updateColumnTexts(root: HTMLElement, columns: readonly Column[] = COLUMNS): void {
  for (const column of columns) {
    const section = root.querySelector<HTMLElement>(`[data-column-id="${column.id}"]`);
    if (section === null) continue;

    const heading = section.querySelector('.column-heading');
    if (heading !== null) heading.textContent = t(column.headingKey);

    const placeholder = section.querySelector('.column-placeholder');
    if (placeholder !== null) placeholder.textContent = t(column.placeholderKey);
  }
}
