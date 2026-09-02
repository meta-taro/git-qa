import { MAIN_COLUMN_ID } from '../columns.js';
import { t } from '../i18n/current.js';
import type { MessageKey } from '../i18n/index.js';

/**
 * アプリを開いた人に、**次にやること**を出す（Issue 011 段階 2）。
 *
 * **空の枠を出して黙るのが一番まずい。**いまの入口はターミナルなので、
 * アプリを開いただけでは何も起きず、何をすればよいかも分からない。
 *
 * 出す場所は**中央**。ここは繋がるまで空で、画面の中で一番広い。繋がったら映像が上書きする。
 */

export type ConnectionStatus =
  /** 何にも繋がっていない。 */
  | 'disconnected'
  /** 端末には繋がっているが、実行はしていない（`pnpm live` の状態）。 */
  | 'device-only'
  /** 実行中。案内は出さない。 */
  | 'running';

export function connectionStatus(urls: {
  liveUrl?: string;
  controlUrl?: string;
}): ConnectionStatus {
  if (urls.controlUrl !== undefined && urls.liveUrl !== undefined) return 'running';
  return urls.liveUrl === undefined ? 'disconnected' : 'device-only';
}

interface Step {
  readonly titleKey: MessageKey;
  readonly detailKey: MessageKey;
  /** 打つもの。文言ではないので訳さない。 */
  readonly command?: string;
}

const STEPS: readonly Step[] = [
  {
    titleKey: 'onboarding.step.device.title',
    detailKey: 'onboarding.step.device.detail',
    command: 'adb devices',
  },
  {
    titleKey: 'onboarding.step.sheet.title',
    detailKey: 'onboarding.step.sheet.detail',
  },
  {
    titleKey: 'onboarding.step.run.title',
    detailKey: 'onboarding.step.run.detail',
    command: 'pnpm run:sheet <検証シート.tsv>',
  },
];

/**
 * いまやること。**必ず 1 つだけ。**並べただけだと、どこから手を付けるか分からない。
 * 端末が繋がったら 3 へ飛ぶ（シートの用意はいつやってもよいので、印は付けない）。
 */
const CURRENT_STEP: Readonly<Record<ConnectionStatus, number>> = {
  disconnected: 0,
  'device-only': 2,
  running: -1,
};

function liveColumn(root: HTMLElement): HTMLElement {
  const column = root.querySelector<HTMLElement>(`[data-column-id="${MAIN_COLUMN_ID}"]`);
  if (column === null) {
    throw new Error(`ライブビューのカラム（${MAIN_COLUMN_ID}）が画面に無い`);
  }
  return column;
}

function stepElement(doc: Document, step: Step, isCurrent: boolean): HTMLElement {
  const item = doc.createElement('li');
  item.className = 'onboarding-step';
  if (isCurrent) item.setAttribute('aria-current', 'step');

  const title = doc.createElement('p');
  title.className = 'onboarding-step-title';
  title.textContent = isCurrent
    ? `${t(step.titleKey)} — ${t('onboarding.current')}`
    : t(step.titleKey);

  const detail = doc.createElement('p');
  detail.className = 'onboarding-step-detail';
  detail.textContent = t(step.detailKey);

  item.append(title, detail);

  if (step.command !== undefined) {
    const command = doc.createElement('code');
    command.className = 'onboarding-command';
    command.textContent = step.command;
    item.append(command);
  }
  return item;
}

/**
 * 中央のカラムに案内を出す。**実行中は出さない**（映像の邪魔をしない）。
 */
export function renderOnboarding(root: HTMLElement, status: ConnectionStatus): void {
  const doc = root.ownerDocument;
  const column = liveColumn(root);
  column.querySelector('.onboarding')?.remove();
  if (status === 'running') return;

  const section = doc.createElement('div');
  section.className = 'onboarding';

  const title = doc.createElement('h3');
  title.className = 'onboarding-title';
  title.textContent = t('onboarding.title');

  const lead = doc.createElement('p');
  lead.className = 'onboarding-lead';
  lead.textContent = t('onboarding.lead');

  const list = doc.createElement('ol');
  list.className = 'onboarding-steps';
  const current = CURRENT_STEP[status];
  for (const [index, step] of STEPS.entries()) {
    list.append(stepElement(doc, step, index === current));
  }

  const note = doc.createElement('p');
  note.className = 'onboarding-note';
  // 正直に書く。ここから始められないことを、黙って隠さない。
  note.textContent = t('onboarding.terminal');

  section.append(title, lead, list, note);
  column.querySelector('.column-placeholder')?.remove();
  column.append(section);
}
