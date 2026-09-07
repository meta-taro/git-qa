import { isValidHandle } from '@git-qa/core/session';
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
  readonly onStart: (params: {
    serial: string;
    sheetPath: string;
    operator: string;
    /** 見るブラウザ（ウェブのときだけ意味がある）。 */
    browser?: string;
    /** 名前の無いブラウザの場所。 */
    browserPath?: string;
  }) => void;
  /**
   * 自分で検証シートを選ぶ。
   *
   * **配布物では作業ディレクトリが `/` になる**ので、探して並べるだけでは足りない
   * （実機で「検証シートが無い」と出た）。
   */
  readonly onPickSheet?: () => void;
  /** 人が選んだシート。一覧に無くてもこれで始められる。 */
  readonly pickedSheet?: string;
  /**
   * 最近開いた検証シート。
   *
   * **ホームの下を漁るのをやめた代わりの口。**探索が届くのは git-qa 専用の置き場と
   * 作業ディレクトリだけなので、リポジトリの中のシートはここから出る。
   */
  readonly recentSheets?: readonly string[];
  /**
   * 置いた人のハンドル。**`unknown` のまま証跡に残ると「誰が保証したか」が読めない**ので、
   * 空のままでは始められないようにする。
   */
  readonly operator?: string;
  /** ウェブページの URL。**覚えておく**（毎回打たせない）。 */
  readonly webUrl?: string;
  readonly onWebUrlChange?: (url: string) => void;
  /** 見るブラウザ。**証跡に版が残る。** */
  readonly browser?: string;
  readonly onBrowserChange?: (browser: string) => void;
  /** 名前の無いブラウザの場所。**「その他」を選んだときだけ使う。** */
  readonly browserPath?: string;
  readonly onBrowserPathChange?: (path: string) => void;
  readonly onOperatorChange?: (handle: string) => void;
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

/**
 * なぜ始められないのか。**押せないボタンは、理由まで出して初めて意味がある。**
 *
 * 2026-09-04、人が実物を開いて「検証開始ボタン押せないですね」と言った。
 * 保存されていたハンドルが `めたたろ`（日本語）で、C45 の入口の検査が弾いていた。
 * **弾いたのは正しい。**出していなかったのは、弾いた理由のほう。
 */
function blockedReason(
  handle: string,
  serial: string | undefined,
  sheet: string | undefined,
): string | undefined {
  if (handle === '') return t('setup.blocked.operator.empty');
  // **日本語のハンドルは通る**（C53）。弾くのは空白・区切り・長すぎるものだけ。
  if (!isValidHandle(handle)) return t('setup.blocked.operator.bad');
  if (serial === undefined) return t('setup.blocked.device');
  if (sheet === undefined) return t('setup.blocked.sheet');
  return undefined;
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
  // 人が自分で選んだものがあれば、そちらが優先。
  const defaultSerial = state.devices[0]?.serial;
  /**
   * 一覧に出すシート。**前に開いたものを先に並べる**（探索で届かない場所にあることが多い）。
   * 同じものを二重に並べない。
   */
  const sheets = [...new Set([...(options.recentSheets ?? []), ...state.sheets])];
  const defaultSheet = options.pickedSheet ?? sheets[0];

  const section = doc.createElement('div');
  section.className = 'setup';

  const title = doc.createElement('h3');
  title.className = 'setup-title';
  title.textContent = t('setup.title');

  const operatorHeading = doc.createElement('p');
  operatorHeading.className = 'setup-heading';
  operatorHeading.textContent = t('setup.operator');

  const operator = doc.createElement('input');
  operator.type = 'text';
  operator.className = 'setup-operator';
  operator.placeholder = t('setup.operator.placeholder');
  operator.value = options.operator ?? '';

  /**
   * ハンドルの規則。**証跡の schema が正本**（C18）で、そこは ASCII に限っている。
   * ここで通すと、5 件置き終わったあとの保存で落ちる
   * — 実際に人が実機で置いた 5 件が 2 回とも消えた（2026-09-04）。
   */
  const operatorRule = doc.createElement('p');
  operatorRule.className = 'setup-hint';
  operatorRule.textContent = t('setup.operator.rule');

  /**
   * ハンドル・端末・シートの状態を、画面の 3 箇所へ同時に反映する。
   * **押せるかどうか（ボタン）・規則を破っているか（印）・なぜ始まらないか（文）**を
   * 別々に更新すると、どれかが取り残される。
   */
  /**
   * ウェブページを見る口（Issue 015 / C54）。
   *
   * **配布物から使えないと意味がない。**`pnpm live:web` はターミナルの話で、
   * 実際に検証する人はアプリしか開かない。ここに URL を入れたら、そちらを見る。
   */
  const webUrl = doc.createElement('input');
  webUrl.type = 'text';
  webUrl.className = 'setup-web';
  webUrl.placeholder = t('setup.web.placeholder');
  webUrl.value = options.webUrl ?? '';
  const webHint = doc.createElement('p');
  webHint.className = 'setup-hint';
  webHint.textContent = t('setup.web');

  /**
   * どのブラウザで見るか（人の求め・2026-09-06）。
   *
   * > chrome, エッヂを選択できて、検証時につかったブラウザのバージョンなども
   * > 記録できるとなおよいです。
   *
   * **同じ画面でも版が違えば結果が変わる。**選べて、証跡に残るようにする。
   */
  const browser = doc.createElement('select');
  browser.className = 'setup-browser';
  for (const [value, key] of [
    ['chrome', 'setup.browser.chrome'],
    ['edge', 'setup.browser.edge'],
    ['brave', 'setup.browser.brave'],
    ['opera', 'setup.browser.opera'],
    ['vivaldi', 'setup.browser.vivaldi'],
    // **エンジンが違う。**Firefox は BiDi、Safari は WebDriver（Issue 018）。
    ['firefox', 'setup.browser.firefox'],
    ['safari', 'setup.browser.safari'],
    ['other', 'setup.browser.other'],
  ] as const) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = t(key);
    browser.append(option);
  }
  browser.value = options.browser ?? 'chrome';
  browser.addEventListener('change', () => options.onBrowserChange?.(browser.value));

  const browserLabel = doc.createElement('p');
  browserLabel.className = 'setup-hint';
  browserLabel.textContent = t('setup.browser');

  /**
   * 名前の無いブラウザ。**数え上げに行かない。**
   *
   * セキュリティソフトが出すブラウザは数えきれないし、増える。
   * **中身が Chromium なら、場所さえ分かれば動く**ので、指定できるようにする。
   */
  const browserPath = doc.createElement('input');
  browserPath.type = 'text';
  browserPath.className = 'setup-web';
  browserPath.placeholder = t('setup.browser.path.placeholder');
  browserPath.value = options.browserPath ?? '';
  browserPath.hidden = browser.value !== 'other';

  const browserPathHint = doc.createElement('p');
  browserPathHint.className = 'setup-hint';
  browserPathHint.textContent = t('setup.browser.path');
  browserPathHint.hidden = browserPath.hidden;

  browserPath.addEventListener('input', () => options.onBrowserPathChange?.(browserPath.value));
  browser.addEventListener('change', () => {
    // 「その他」を選んだときだけ、場所の欄を出す。**出しっぱなしにしない。**
    browserPath.hidden = browser.value !== 'other';
    browserPathHint.hidden = browserPath.hidden;
  });

  const lookingAt = (): string | undefined => {
    const url = webUrl.value.trim();
    // **URL が優先。**打ち込んだ人は、そちらを見たいと言っている。
    if (url !== '') return /^https?:\/\//.test(url) ? url : undefined;
    // 人が選んだ端末。選んでいなければ、一覧の先頭。
    return picked(column, 'setup-device', 'serial') ?? defaultSerial;
  };

  const reflect = (handle: string): void => {
    // 準備中は、ボタンの文字（「準備しています…」）が理由を兼ねる。
    const reason =
      state.phase === 'starting' ? undefined : blockedReason(handle, lookingAt(), defaultSheet);
    start.disabled = state.phase === 'starting' || reason !== undefined;
    operatorRule.dataset['bad'] = handle !== '' && !isValidHandle(handle) ? 'true' : 'false';
    blocked.textContent = reason ?? '';
    // **空の行を置かない。**理由が無いときに間だけが空くのは、何かを見落とした形に見える。
    if (reason === undefined) blocked.remove();
    else section.append(blocked);
  };

  operator.addEventListener('input', () => {
    const handle = operator.value.trim();
    reflect(handle);
    options.onOperatorChange?.(handle);
  });

  // URL を打っている最中も、押せるかどうかを合わせる。**打ち終わるまで黙らない。**
  webUrl.addEventListener('input', () => {
    reflect(operator.value.trim());
    options.onWebUrlChange?.(webUrl.value.trim());
  });

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

  /**
   * 押せない理由。**選べていないなら押させない**が、黙って死んだボタンにはしない。
   * **誰が置いたか分からない証跡を作らない**ので、規則に合わないハンドルもここで止める
   * （通すと、置き終わったあとの保存で落ちる）。
   */
  const blocked = doc.createElement('p');
  blocked.className = 'setup-blocked';

  start.addEventListener('click', () => {
    const serial = lookingAt();
    // 一覧から選ばれていなければ、人が自分で選んだものを使う。
    const sheetPath = picked(column, 'setup-sheet', 'path') ?? options.pickedSheet;
    const handle = operator.value.trim();
    if (serial === undefined || sheetPath === undefined || !isValidHandle(handle)) return;
    options.onStart({
      serial,
      sheetPath,
      operator: handle,
      browser: browser.value,
      ...(browser.value === 'other' && browserPath.value.trim() !== ''
        ? { browserPath: browserPath.value.trim() }
        : {}),
    });
  });

  section.append(
    title,
    operatorHeading,
    operator,
    operatorRule,
    deviceHeading,
    webUrl,
    webHint,
    browser,
    browserLabel,
    browserPath,
    browserPathHint,
  );

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

  // **自分で選んだものも一覧に出す。**選んだのに画面に出ないと、選べたのか分からない。
  const listed =
    options.pickedSheet === undefined || sheets.includes(options.pickedSheet)
      ? sheets
      : [options.pickedSheet, ...sheets];

  if (listed.length === 0) {
    const empty = doc.createElement('p');
    empty.className = 'setup-empty';
    empty.textContent = t('setup.sheet.none');
    section.append(empty);
  } else {
    section.append(
      pickList(
        doc,
        listed.map((path) => ({ value: path, label: path })),
        'setup-sheet',
        'path',
        defaultSheet,
        () => {},
      ),
    );
  }

  if (options.onPickSheet !== undefined) {
    const pick = doc.createElement('button');
    pick.type = 'button';
    pick.className = 'setup-pick';
    pick.textContent = t('setup.pick');
    pick.addEventListener('click', () => options.onPickSheet?.());
    section.append(pick);
  }

  section.append(start);

  // **保存済みの値を戻したときも印を立てる。**打ち始めるまで黙っていては遅い。
  // 組み上がってから当てるので、理由の行はボタンの下に入る。
  reflect((options.operator ?? '').trim());

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
