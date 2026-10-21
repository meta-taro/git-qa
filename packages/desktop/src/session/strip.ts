import type { SessionState } from '@git-qa/core/session';

import { MAIN_COLUMN_ID } from '../columns.js';
import { t } from '../i18n/current.js';
import { caseLabel } from './view.js';

/**
 * **映像の上の 1 行**（2026-10-21・DESIGN.md「映像の上の 1 行」）。
 *
 * いま見ているケースの番号と題名。**映像からいちばん近い所で、何を見ればよいかが読める。**
 * 映像（canvas）には触らない —— この 1 行だけを置き換える。
 */
export function renderCaseStrip(
  root: HTMLElement,
  state: SessionState | undefined,
  cursor: number | undefined,
): void {
  const column = root.querySelector<HTMLElement>(`[data-column-id="${MAIN_COLUMN_ID}"]`);
  if (column === null) return;
  column.querySelector('.case-strip')?.remove();
  if (state === undefined) return;

  const doc = root.ownerDocument;
  const strip = doc.createElement('div');
  strip.className = 'case-strip';

  const looking = state.cases.find((c) => c.no === (cursor ?? state.awaiting));
  if (looking === undefined) {
    const said = doc.createElement('span');
    said.className = 'case-strip-title';
    said.textContent = t(state.phase === 'finished' ? 'verdict.finished' : 'verdict.running');
    strip.append(said);
  } else {
    const no = doc.createElement('span');
    no.className = 'case-strip-no';
    no.textContent = caseLabel(looking.no);
    const title = doc.createElement('span');
    title.className = 'case-strip-title';
    title.textContent = looking.title;
    strip.append(no, title);
  }
  // 欄の見出しのすぐ下。**見出しより上に出すと、何の欄か分からなくなる。**
  const heading = column.querySelector('.column-heading');
  if (heading === null) column.prepend(strip);
  else heading.after(strip);
}
