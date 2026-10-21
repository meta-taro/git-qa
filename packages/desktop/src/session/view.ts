import { resolveCaseResult } from '@git-qa/core/session';
import type { SessionCase, SessionField, SessionState } from '@git-qa/core/session';

import { t } from '../i18n/current.js';
import { KEY_BINDINGS, keyCap } from './keys.js';
import { tagFor } from './marks.js';

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

/** `#03` の形。**一覧・帯・判定の欄で同じ書き方にする。** */
export function caseLabel(no: number): string {
  return `#${String(no).padStart(2, '0')}`;
}

/**
 * 一覧の 2 行目。**誰が見たか・見ていないか**を、題名の下に小さく出す。
 * 持っていない値は書かない（時刻は状態に無いので出さない）。
 */
function caseSub(subject: SessionCase, awaiting: boolean): string {
  const parts = [caseLabel(subject.no)];
  if (subject.result === undefined) {
    parts.push(t(awaiting ? 'case.sub.awaiting' : 'case.sub.pending'));
  } else if (subject.result === 'AUTO_PASS') {
    parts.push(t('case.sub.auto'));
  } else {
    parts.push(subject.result);
    if (subject.verifiedBy !== undefined)
      parts.push(`${t('case.sub.person')} ${subject.verifiedBy}`);
  }
  return parts.join(' · ');
}

function caseItem(
  doc: Document,
  subject: SessionCase,
  awaiting: number | undefined,
  cursor: number | undefined,
): HTMLElement {
  const item = doc.createElement('li');
  item.className = 'case-item';
  item.dataset['caseNo'] = String(subject.no);
  if (subject.result !== undefined) item.dataset['result'] = subject.result;
  const isAwaiting = awaiting === subject.no;
  if (isAwaiting) item.setAttribute('aria-current', 'true');
  // **見ている所と、打鍵待ちの所は別**（Issue 013）。戻って直しているときに混ざらないように。
  if (cursor === subject.no) item.setAttribute('aria-selected', 'true');

  /**
   * 判定の札。**色が付くのは「人が見たもの」と、いま待っている 1 件だけ**（`marks.ts`）。
   * 一覧を眺めただけで、人が見た所と AI が言っただけの所が分かる。
   */
  const tag = doc.createElement('span');
  tag.className = 'case-tag';
  tag.textContent = tagFor(subject.result, isAwaiting);

  const body = doc.createElement('span');
  body.className = 'case-body';

  const label = doc.createElement('span');
  label.className = 'case-title';
  label.textContent = subject.title;

  const sub = doc.createElement('span');
  sub.className = 'case-sub';
  sub.textContent = caseSub(subject, isAwaiting);

  body.append(label, sub);
  item.append(tag, body);
  return item;
}

export type CaseFilter = 'all' | 'attention';

/**
 * **まだ人が見ていないもの**（結果が無い・AUTO_PASS）。「要確認」で残す。
 * いま待っている 1 件と、見ている 1 件は、絞っても必ず残す（消えると押す相手が分からない）。
 */
function needsLook(subject: SessionCase): boolean {
  return subject.result === undefined || subject.result === 'AUTO_PASS';
}

function caseFilterBar(
  doc: Document,
  cases: readonly SessionCase[],
  filter: CaseFilter,
): HTMLElement {
  const bar = doc.createElement('div');
  bar.className = 'case-filter';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', t('cases.filter.label'));
  const options: [CaseFilter, string][] = [
    ['attention', t('cases.filter.attention', { count: String(cases.filter(needsLook).length) })],
    ['all', t('cases.filter.all')],
  ];
  for (const [value, text] of options) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'case-filter-option';
    button.dataset['filter'] = value;
    button.setAttribute('aria-pressed', String(value === filter));
    button.textContent = text;
    bar.append(button);
  }
  return bar;
}

/** 絞り込みを押せるようにする。**根元で受ける**（一覧は状態が来るたびに作り直される）。 */
export function installCaseFilter(
  root: HTMLElement,
  onChange: (filter: CaseFilter) => void,
): () => void {
  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const value = target.closest<HTMLElement>('.case-filter-option')?.dataset['filter'];
    if (value === 'all' || value === 'attention') onChange(value);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

function renderCases(
  root: HTMLElement,
  state: SessionState,
  cursor: number | undefined,
  filter: CaseFilter,
): void {
  const target = column(root, CASES_COLUMN);
  resetBody(target);

  target.append(caseFilterBar(root.ownerDocument, state.cases, filter));

  const list = root.ownerDocument.createElement('ol');
  list.className = 'case-list';
  for (const subject of state.cases) {
    const keep =
      filter === 'all' ||
      needsLook(subject) ||
      subject.no === state.awaiting ||
      subject.no === cursor;
    if (!keep) continue;
    list.append(caseItem(root.ownerDocument, subject, state.awaiting, cursor));
  }
  target.append(list);
}

/**
 * 押せる判定の一覧。**打鍵だけにしない。**
 *
 * 初めて触る人は、どのキーが何をするか知らない。見えているものを押せるほうが早い。
 * 押した結果は打鍵とまったく同じ道を通る（`data-key` に割り当てを持たせる）。
 */
/** **判定を置く 5 つ。**札にして大きく出す（DESIGN.md「判定の札」）。残りは脇の手。 */
const VERDICT_KEYS_SHOWN = new Set(['d', 'f', 'a', 's', ' ']);

function renderKeyHelp(doc: Document, enabled: boolean): HTMLElement[] {
  const list = doc.createElement('div');
  list.className = 'key-help';
  const more = doc.createElement('div');
  more.className = 'key-help-more';
  const moreLabel = doc.createElement('p');
  moreLabel.className = 'verdict-section-label';
  moreLabel.textContent = t('verdict.moreKeys');

  for (const binding of KEY_BINDINGS) {
    const action = doc.createElement('button');
    action.type = 'button';
    action.className = 'key-action';
    action.dataset['key'] = binding.key;
    // **人の番でなければ押せない。**AI が操作している最中に判定を置かせない。
    action.disabled = !enabled;

    const cap = doc.createElement('span');
    cap.className = 'key-binding';
    cap.textContent = keyCap(binding.key);

    const text = doc.createElement('span');
    text.className = 'key-text';

    const label = doc.createElement('span');
    label.className = 'key-label';
    label.textContent = t(binding.labelKey);

    const note = doc.createElement('span');
    note.className = 'key-note';
    // 押す前に、証跡にどう残るかが分かるようにする。
    note.textContent = t(binding.noteKey);
    // 脇の手は札にしないので注記を畳む。**指を載せれば読める**ようにしておく。
    action.title = t(binding.noteKey);

    text.append(label, note);
    action.append(cap, text);
    (VERDICT_KEYS_SHOWN.has(binding.key) ? list : more).append(action);
  }
  return [list, moreLabel, more];
}

function sectionLabel(doc: Document, key: 'verdict.yours' | 'verdict.aiView'): HTMLElement {
  const label = doc.createElement('p');
  label.className = 'verdict-section-label';
  label.textContent = t(key);
  return label;
}

/**
 * 判定のボタンを押せるようにする。**描き直しても付け直さなくてよい**ように、
 * 根元で受ける（ボタンは状態が来るたびに作り直される）。
 */
export function installVerdictButtons(root: HTMLElement, onKey: (key: string) => void): () => void {
  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.closest<HTMLElement>('.key-action');
    const key = action?.dataset['key'];
    if (key === undefined) return;
    onKey(key);
  };

  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

function renderVerdict(root: HTMLElement, state: SessionState, cursor: number | undefined): void {
  const doc = root.ownerDocument;
  const target = column(root, VERDICT_COLUMN);
  resetBody(target);

  // **鑑賞中は、いちばん上に出す。**押さなくても進むことと、止める手。
  target.append(...renderWatching(doc, state));

  // 見ているケース。指していなければ、打鍵待ちのケースを見ている。
  const looking = cursor ?? state.awaiting;
  const awaiting = state.cases.find((c) => c.no === looking);
  const revising = looking !== state.awaiting;
  const headline = doc.createElement('p');
  headline.className = 'verdict-headline';

  if (awaiting === undefined) {
    headline.textContent = t(state.phase === 'finished' ? 'verdict.finished' : 'verdict.running');
    target.append(headline);
    if (state.phase === 'finished') {
      target.append(...renderSummary(doc, state));
    } else {
      target.append(sectionLabel(doc, 'verdict.yours'), ...renderKeyHelp(doc, false));
    }
    // **置いた判定がどこへ行ったかを出す。**出さないと、保存されたのか分からないまま終わる。
    target.append(...renderEvidence(doc, state));
    return;
  }

  headline.textContent = `${caseLabel(awaiting.no)} ${awaiting.title}`;
  target.append(headline);

  /**
   * **人が主で、AI の但し書きは脇**（外部レビュー meta-taro/git-qa#19）。
   *
   * > 判定を置く人は「何をすればいいか」も「なぜそれを確かめるのか」も画面から読めません。
   * > 読めるのは AI が自分の限界を説明した文だけです。**順番が逆**だと思いました。
   *
   * 見出しの次が**何をするか**、その次が**何が起きれば合格か**。
   * 列名は決め打ちしない —— **書き手が足した列も、その言葉のまま出る。**
   */
  for (const field of awaiting.fields ?? []) {
    target.append(renderField(doc, field));
  }

  /**
   * **AI の見立ては、判定の札より上。**AI が何と言ったかは、押す前に見える所に在るべき
   * （札を大きくしたので、下へ置くと画面の外へ押し出される）。
   */
  target.append(sectionLabel(doc, 'verdict.aiView'), renderAi(doc, awaiting));

  target.append(sectionLabel(doc, 'verdict.yours'));
  if (revising) {
    // **置いても次へ進まない**ことを、押す前に言う。
    const hint = doc.createElement('p');
    hint.className = 'verdict-revise';
    hint.textContent = t('verdict.revise');
    target.append(hint);
  }

  target.append(...renderKeyHelp(doc, true));
}

/** シートの 1 欄。**書いた人の言葉のまま出す**（外部レビュー meta-taro/git-qa#19）。 */
function renderField(doc: Document, field: SessionField): HTMLElement {
  const box = doc.createElement('div');
  box.className = 'verdict-field';

  const label = doc.createElement('span');
  label.className = 'verdict-field-label';
  label.textContent = field.label;

  const value = doc.createElement('p');
  value.className = 'verdict-field-value';
  value.textContent = field.value;

  box.append(label, value);
  return box;
}

/**
 * AI の判定と、その但し書き。
 *
 * **但し書きは畳んでおく**（外部レビュー #19 の提案 2）。
 * 必要な人は開ける。いちばん目立つ所に置くと、**人が読むべきもの（手順）が下へ押される。**
 * **判定そのものは畳まない** —— AI が何と言ったかは、押す前に見える所に在るべき。
 */
function renderAi(doc: Document, subject: SessionCase): HTMLElement {
  /**
   * **証跡に残る語で出す**（2026-10-13）。素の `PASS` と出していたので、
   * 人が見ていない合格が画面では「合格」に見えた（C1）。
   */
  const result =
    subject.aiResult === undefined ? '' : resolveCaseResult({ aiResult: subject.aiResult });

  const head = doc.createElement(subject.note === undefined ? 'div' : 'summary');
  head.className = 'verdict-ai';
  // **一覧と同じ語・同じ色の札にする**（2026-10-21）。どの判定のことか目で繋がる。
  const tag = doc.createElement('span');
  tag.className = 'verdict-ai-tag';
  tag.dataset['result'] = result;
  tag.textContent = result;
  const label = doc.createElement('span');
  label.className = 'verdict-ai-label';
  label.textContent = t('verdict.aiSaid');
  head.append(tag, label);

  // **開いても何も無い口を出さない。**言い分が無ければ、畳む箱にしない。
  if (subject.note === undefined) {
    head.classList.add('verdict-ai-detail');
    return head;
  }

  const detail = doc.createElement('details');
  detail.className = 'verdict-ai-detail';
  const note = doc.createElement('p');
  note.className = 'verdict-note';
  note.textContent = subject.note;
  detail.append(head, note);
  return detail;
}

/**
 * **鑑賞中の案内**（2026-09-11・人の指示）。
 *
 * 人は見守るだけで進み、途中で止められることも要る。
 *
 * **押さなくても進むことを、出し続ける。**出ていなければ、人は
 * 「押さないと進まない」と思って待つ。
 *
 * **止める手も、押しボタンで出す。**打鍵だけにしない —— 初めて触る人は Esc を知らない
 * （判定のボタンを足したときと同じ理由）。
 */
function renderWatching(doc: Document, state: SessionState): HTMLElement[] {
  if (state.phase !== 'watching' || state.watch === undefined) return [];

  const banner = doc.createElement('p');
  banner.className = 'verdict-watching';
  banner.textContent = t('verdict.watching', {
    // 秒で出す。ミリ秒は人が読む単位ではない。
    seconds: String(Math.round(state.watch.pauseMs / 100) / 10),
  });

  const stop = doc.createElement('button');
  stop.type = 'button';
  stop.className = 'key-action verdict-stop';
  // **判定のボタンと同じ道を通す**（`installVerdictButtons` が拾う）。
  stop.dataset['key'] = 'Escape';
  stop.textContent = `${t('verdict.stop')}（${keyCap('Escape')}）`;

  return [banner, stop];
}

/**
 * **終わったときのまとめ**（2026-10-21・DESIGN.md「まとめ」）。
 *
 * いちばん大きく出すのは**人が見て確かめた数**。AUTO_PASS は合格の数に混ぜず、
 * **誰も見ていないこと**を言葉で添える（C1）。
 */
function renderSummary(doc: Document, state: SessionState): HTMLElement[] {
  const total = state.cases.length;
  const count = (result: string): number => state.cases.filter((c) => c.result === result).length;
  const human = count('VERIFIED');

  const box = doc.createElement('div');
  box.className = 'summary';

  const label = doc.createElement('p');
  label.className = 'verdict-section-label';
  label.textContent = t('summary.human');

  const big = doc.createElement('p');
  big.className = 'summary-big';
  const n = doc.createElement('span');
  n.textContent = String(human);
  const of = doc.createElement('span');
  of.className = 'summary-of';
  of.textContent = ` / ${String(total)}`;
  big.append(n, of);

  const counts = doc.createElement('dl');
  counts.className = 'summary-counts';
  for (const result of ['AUTO_PASS', 'FAIL', 'BLOCKED', 'SKIP'] as const) {
    const item = doc.createElement('div');
    item.dataset['result'] = result;
    const dt = doc.createElement('dt');
    dt.textContent = result;
    const dd = doc.createElement('dd');
    dd.textContent = String(count(result));
    item.append(dt, dd);
    counts.append(item);
  }

  box.append(label, big, counts);

  const auto = count('AUTO_PASS');
  if (auto > 0) {
    const note = doc.createElement('p');
    note.className = 'summary-note';
    note.textContent = t('summary.autoNote', { count: String(auto) });
    box.append(note);
  }
  return [box];
}

/**
 * 証跡の行方を出す。**書けたなら場所を、書けなかったなら理由を。**
 *
 * 配布物には書く処理が無く、人が 5 件を置いても何も残らないまま終わっていた
 * （2026-09-04・実機で踏んだ）。**保存されたかどうかが分からないまま終わらせない。**
 */
function renderEvidence(doc: Document, state: SessionState): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (state.runJsonPath !== undefined) {
    const saved = doc.createElement('p');
    saved.className = 'verdict-evidence';
    saved.textContent = `${t('verdict.saved')} ${state.runJsonPath}`;
    out.push(saved);
  }
  if (state.saveError !== undefined) {
    const failed = doc.createElement('p');
    failed.className = 'session-error';
    failed.textContent = `${t('verdict.saveFailed')} ${state.saveError}`;
    out.push(failed);
  }
  return out;
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

export interface RenderSessionOptions {
  /** いま見ているケース。**実行の進行とは別**（戻って置き直すため・Issue 013）。 */
  readonly cursor?: number;
  /** 一覧の絞り込み。**既定は全部**（絞ったことに気づかず、ケースが消えたと思わせない）。 */
  readonly filter?: CaseFilter;
}

export function renderSession(
  root: HTMLElement,
  state: SessionState,
  options: RenderSessionOptions = {},
): void {
  renderCases(root, state, options.cursor, options.filter ?? 'all');
  renderVerdict(root, state, options.cursor);
}
