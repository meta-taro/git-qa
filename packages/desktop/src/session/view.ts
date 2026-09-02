import type { SessionCase, SessionState } from '@git-qa/core/session';

import { t } from '../i18n/current.js';
import { KEY_BINDINGS } from './keys.js';

/**
 * 左にケース一覧、右に判定とキー一覧を描く。
 *
 * **中央（ライブビュー）には触らない。**そこが主媒体で、映像が描かれている（C4 / C27）。
 * 状態が来るたびに描き直すので、**同じ状態を 2 回描いても増えない**形にする。
 */

const CASES_COLUMN = 'cases';
const VERDICT_COLUMN = 'verdict';

function column(root: HTMLElement, id: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[data-column-id="${id}"]`);
  if (found === null) {
    // 握り潰さない。カラムの構成を変えたときに、静かに出なくなるのを防ぐ。
    throw new Error(`カラム ${id} が画面に無い`);
  }
  return found;
}

/** 見出しだけ残して中身を捨てる。描き直しで増えないように。 */
function resetBody(target: HTMLElement): void {
  for (const child of [...target.children]) {
    if (!child.classList.contains('column-heading')) child.remove();
  }
}

function caseItem(doc: Document, subject: SessionCase, awaiting: number | undefined): HTMLElement {
  const item = doc.createElement('li');
  item.className = 'case-item';
  item.dataset['caseNo'] = String(subject.no);
  if (subject.result !== undefined) item.dataset['result'] = subject.result;
  if (awaiting === subject.no) item.setAttribute('aria-current', 'true');

  const label = doc.createElement('span');
  label.className = 'case-title';
  label.textContent = `${String(subject.no)}. ${subject.title}`;

  const status = doc.createElement('span');
  status.className = 'case-status';
  // **空欄は空欄のまま出す**（product-baseline §19）。まだ確定していないものを埋めない。
  status.textContent =
    subject.result === undefined
      ? ''
      : subject.verifiedBy === undefined
        ? subject.result
        : `${subject.result} / ${subject.verifiedBy}`;

  item.append(label, status);
  return item;
}

function renderCases(root: HTMLElement, state: SessionState): void {
  const target = column(root, CASES_COLUMN);
  resetBody(target);

  const list = root.ownerDocument.createElement('ol');
  list.className = 'case-list';
  for (const subject of state.cases) {
    list.append(caseItem(root.ownerDocument, subject, state.awaiting));
  }
  target.append(list);
}

function renderKeyHelp(doc: Document): HTMLElement {
  const list = doc.createElement('dl');
  list.className = 'key-help';
  for (const binding of KEY_BINDINGS) {
    const key = doc.createElement('dt');
    key.className = 'key-binding';
    key.textContent = binding.key === ' ' ? 'Space' : binding.key;
    const label = doc.createElement('dd');
    label.className = 'key-label';
    label.textContent = t(binding.labelKey);
    list.append(key, label);
  }
  return list;
}

function renderVerdict(root: HTMLElement, state: SessionState): void {
  const doc = root.ownerDocument;
  const target = column(root, VERDICT_COLUMN);
  resetBody(target);

  const awaiting = state.cases.find((c) => c.no === state.awaiting);
  const headline = doc.createElement('p');
  headline.className = 'verdict-headline';

  if (awaiting === undefined) {
    headline.textContent = t(state.phase === 'finished' ? 'verdict.finished' : 'verdict.running');
    target.append(headline);
    if (state.phase !== 'finished') target.append(renderKeyHelp(doc));
    return;
  }

  headline.textContent = `${String(awaiting.no)}. ${awaiting.title}`;

  const ai = doc.createElement('p');
  ai.className = 'verdict-ai';
  // **AI が何を見たかを人へ見せる。**見ずに置くための道具ではない。
  ai.textContent = `AI の判定: ${awaiting.aiResult ?? ''}`;

  const note = doc.createElement('p');
  note.className = 'verdict-note';
  note.textContent = awaiting.note ?? '';

  target.append(headline, ai, note, renderKeyHelp(doc));
}

/**
 * 打鍵が届かなかったことを、右のカラムに出す。
 *
 * **console だけでは人に見えない。**押したのに何も起きないと、人は置いたつもりで待つ。
 */
export function showSessionError(root: HTMLElement, message: string): void {
  const target = column(root, VERDICT_COLUMN);
  target.querySelector('.session-error')?.remove();

  const paragraph = root.ownerDocument.createElement('p');
  paragraph.className = 'session-error';
  paragraph.textContent = message;
  target.append(paragraph);
}

export function renderSession(root: HTMLElement, state: SessionState): void {
  renderCases(root, state);
  renderVerdict(root, state);
}
