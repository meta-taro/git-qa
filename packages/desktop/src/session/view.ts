import type { SessionCase, SessionField, SessionState } from '@git-qa/core/session';

import { t } from '../i18n/current.js';
import { KEY_BINDINGS, keyCap } from './keys.js';
import { markFor } from './marks.js';

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
  if (awaiting === subject.no) item.setAttribute('aria-current', 'true');
  // **見ている所と、打鍵待ちの所は別**（Issue 013）。戻って直しているときに混ざらないように。
  if (cursor === subject.no) item.setAttribute('aria-selected', 'true');

  const label = doc.createElement('span');
  label.className = 'case-title';
  label.textContent = `${String(subject.no)}. ${subject.title}`;

  /**
   * 判定の記号。**色が付くのは「人が見たもの」だけ**（`marks.ts`）。
   * 一覧を眺めただけで、人が見た所と AI が言っただけの所が分かる。
   */
  const mark = doc.createElement('span');
  mark.className = 'case-mark';
  mark.textContent = markFor(subject.result);
  mark.setAttribute('aria-hidden', 'true');

  const status = doc.createElement('span');
  status.className = 'case-status';
  // **空欄は空欄のまま出す**（product-baseline §19）。まだ確定していないものを埋めない。
  status.textContent =
    subject.result === undefined
      ? ''
      : subject.verifiedBy === undefined
        ? subject.result
        : `${subject.result} / ${subject.verifiedBy}`;

  item.append(mark, label, status);
  return item;
}

function renderCases(root: HTMLElement, state: SessionState, cursor: number | undefined): void {
  const target = column(root, CASES_COLUMN);
  resetBody(target);

  const list = root.ownerDocument.createElement('ol');
  list.className = 'case-list';
  for (const subject of state.cases) {
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
function renderKeyHelp(doc: Document, enabled: boolean): HTMLElement {
  const list = doc.createElement('div');
  list.className = 'key-help';

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

    text.append(label, note);
    action.append(cap, text);
    list.append(action);
  }
  return list;
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
    // **置いた判定がどこへ行ったかを出す。**出さないと、保存されたのか分からないまま終わる。
    target.append(...renderEvidence(doc, state));
    if (state.phase !== 'finished') target.append(renderKeyHelp(doc, false));
    return;
  }

  headline.textContent = `${String(awaiting.no)}. ${awaiting.title}`;
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

  target.append(renderAi(doc, awaiting));

  if (revising) {
    // **置いても次へ進まない**ことを、押す前に言う。
    const hint = doc.createElement('p');
    hint.className = 'verdict-revise';
    hint.textContent = t('verdict.revise');
    target.append(hint);
  }

  target.append(renderKeyHelp(doc, true));
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
  const detail = doc.createElement('details');
  detail.className = 'verdict-ai-detail';

  const head = doc.createElement('summary');
  head.className = 'verdict-ai';
  head.textContent = `AI の判定: ${subject.aiResult ?? ''}`;

  const note = doc.createElement('p');
  note.className = 'verdict-note';
  note.textContent = subject.note ?? '';

  detail.append(head, note);
  return detail;
}

/**
 * **鑑賞中の案内**（2026-09-11・人の指示）。
 *
 * > 人はぼーっとみながら AI のテストを鑑賞します。……途中で止められる配慮も必要です。
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
}

export function renderSession(
  root: HTMLElement,
  state: SessionState,
  options: RenderSessionOptions = {},
): void {
  renderCases(root, state, options.cursor);
  renderVerdict(root, state, options.cursor);
}
