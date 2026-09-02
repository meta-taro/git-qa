import { MAIN_COLUMN_ID } from '../columns.js';
import { t } from '../i18n/current.js';
import type { SetupState } from './client.js';

/**
 * 端末と検証シートを選んで、実行を始める画面（Issue 011 段階 3）。
 *
 * **アプリを開いた人が、ターミナルを見ずにここまで来られること**が目的。
 * 出す場所は中央。繋がるまでここは空で、始まったら映像が上書きする。
 */

export interface RenderSetupOptions {
  readonly onStart: (params: { serial: string; sheetPath: string }) => void;
}

function liveColumn(root: HTMLElement): HTMLElement {
  const column = root.querySelector<HTMLElement>(`[data-column-id="${MAIN_COLUMN_ID}"]`);
  if (column === null) {
    throw new Error(`ライブビューのカラム（${MAIN_COLUMN_ID}）が画面に無い`);
  }
  return column;
}

/**
 * 選べるものを 1 行ずつ。
 *
 * **選んだ印は DOM に持たせる**（`aria-pressed`）。描き直して選び直させると、
 * 押した瞬間に選択が消える（実際にそうなった）。
 */
function pickList(
  doc: Document,
  items: readonly { value: string; label: string }[],
  className: string,
  attribute: string,
  selected: string | undefined,
  onPick: () => void,
): HTMLElement {
  const list = doc.createElement('div');
  list.className = `${className}-list`;

  for (const item of items) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset[attribute] = item.value;
    button.textContent = item.label;
    button.setAttribute('aria-pressed', String(item.value === selected));
    button.addEventListener('click', () => {
      for (const sibling of list.querySelectorAll(`.${className}`)) {
        sibling.setAttribute('aria-pressed', String(sibling === button));
      }
      onPick();
    });
    list.append(button);
  }
  return list;
}

/** いま選ばれているもの。**画面に出ている印がそのまま答え。** */
function picked(column: HTMLElement, className: string, attribute: string): string | undefined {
  const found = column.querySelector<HTMLElement>(`.${className}[aria-pressed="true"]`);
  return found?.dataset[attribute];
}

export function renderSetup(
  root: HTMLElement,
  state: SetupState,
  options: RenderSetupOptions,
): void {
  const doc = root.ownerDocument;
  const column = liveColumn(root);
  column.querySelector('.setup')?.remove();
  if (state.phase === 'running') return;

  // 既定は 1 つ目。**1 台・1 枚しか無ければ、選ぶ手間を作らない。**
  const defaultSerial = state.devices[0]?.serial;
  const defaultSheet = state.sheets[0];

  const section = doc.createElement('div');
  section.className = 'setup';

  const title = doc.createElement('h3');
  title.className = 'setup-title';
  title.textContent = t('setup.title');

  const deviceHeading = doc.createElement('p');
  deviceHeading.className = 'setup-heading';
  deviceHeading.textContent = t('setup.device');

  const sheetHeading = doc.createElement('p');
  sheetHeading.className = 'setup-heading';
  sheetHeading.textContent = t('setup.sheet');

  const start = doc.createElement('button');
  start.type = 'button';
  start.className = 'setup-start';
  start.textContent = state.phase === 'starting' ? t('setup.starting') : t('setup.start');
  // **選べていないなら押させない。**押しても始まらないボタンは、壊れて見える。
  start.disabled =
    state.phase === 'starting' || defaultSerial === undefined || defaultSheet === undefined;
  start.addEventListener('click', () => {
    const serial = picked(column, 'setup-device', 'serial');
    const sheetPath = picked(column, 'setup-sheet', 'path');
    if (serial === undefined || sheetPath === undefined) return;
    options.onStart({ serial, sheetPath });
  });

  section.append(title, deviceHeading);

  if (state.devices.length === 0) {
    const empty = doc.createElement('p');
    empty.className = 'setup-empty';
    empty.textContent = t('setup.device.none');
    section.append(empty);
  } else {
    section.append(
      pickList(
        doc,
        state.devices.map((d) => ({ value: d.serial, label: `${d.serial}（${d.state}）` })),
        'setup-device',
        'serial',
        defaultSerial,
        () => {},
      ),
    );
  }

  section.append(sheetHeading);

  if (state.sheets.length === 0) {
    const empty = doc.createElement('p');
    empty.className = 'setup-empty';
    empty.textContent = t('setup.sheet.none');
    section.append(empty);
  } else {
    section.append(
      pickList(
        doc,
        state.sheets.map((path) => ({ value: path, label: path })),
        'setup-sheet',
        'path',
        defaultSheet,
        () => {},
      ),
    );
  }

  section.append(start);

  if (state.error !== undefined) {
    // 黙って戻さない。**なぜ始まらなかったのかが人に見えなくなる。**
    const failed = doc.createElement('p');
    failed.className = 'setup-error';
    failed.textContent = t('setup.failed', { message: state.error });
    section.append(failed);
  }

  column.querySelector('.column-placeholder')?.remove();
  column.querySelector('.onboarding')?.remove();
  column.append(section);
}
