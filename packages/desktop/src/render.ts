import type { Column } from './columns.js';
import { COLUMNS } from './columns.js';

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
    heading.textContent = column.heading;

    const placeholder = root.ownerDocument.createElement('p');
    placeholder.className = 'column-placeholder';
    placeholder.textContent = column.placeholder;

    section.append(heading, placeholder);
    root.append(section);
  }
}
