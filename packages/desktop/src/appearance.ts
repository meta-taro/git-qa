import { t } from './i18n/current.js';
import type { MessageKey } from './i18n/index.js';

/**
 * ライト / ダークの切り替え。
 *
 * **色は決めない**（`DESIGN.md` が空・product-baseline §11）。
 * ここで切り替えるのは `color-scheme` と**ウィンドウの外観**だけで、
 * 実際の色は OS が持っているものを使う。
 * **独自の配色をここで置くと、それがそのまま既成事実になる。**
 * `DESIGN.md` が埋まったら、そのときに配色を入れる。
 */

export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof APPEARANCES)[number];

const STORAGE_KEY = 'git-qa.appearance';

/** 覚えておく口。**webview では localStorage が使えないことがある**ので差し替えられる形にする。 */
export interface AppearanceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isAppearance = (value: string): value is Appearance =>
  (APPEARANCES as readonly string[]).includes(value);

const defaultStore = (): AppearanceStore | undefined => {
  try {
    return window.localStorage;
  } catch {
    // 保存が使えない環境（設定で切られている等）。**覚えないだけで、切り替えは効く。**
    return undefined;
  }
};

export function applyAppearance(doc: Document, value: Appearance): void {
  // `light dark` は「OS の設定に従う」。ここで色そのものは指定しない。
  doc.documentElement.style.colorScheme = value === 'system' ? 'light dark' : value;
  doc.documentElement.dataset['appearance'] = value;
}

export function loadAppearance(store: AppearanceStore | undefined = defaultStore()): Appearance {
  try {
    const raw = store?.getItem(STORAGE_KEY) ?? '';
    return isAppearance(raw) ? raw : 'system';
  } catch {
    // 読めないだけ。**既定へ落として動き続ける。**
    return 'system';
  }
}

export function saveAppearance(
  value: Appearance,
  store: AppearanceStore | undefined = defaultStore(),
): void {
  try {
    store?.setItem(STORAGE_KEY, value);
  } catch {
    // 覚えられないだけで、いまの切り替えは効いている。握り潰す理由はこれ。
  }
}

const LABELS: Readonly<Record<Appearance, MessageKey>> = {
  system: 'appearance.system',
  light: 'appearance.light',
  dark: 'appearance.dark',
};

/**
 * ウィンドウ（タイトルバー）の外観を切り替える。
 *
 * **CSS はページの中しか変えない。**枠は OS が描くので、Tauri 側へ伝える必要がある。
 * ブラウザで開いているとき（`pnpm --filter @git-qa/desktop dev`）は Tauri がいないので、
 * **黙って何もしない。**ここで落とすと、ブラウザでは画面が出なくなる。
 */
async function setNativeThemeViaTauri(value: Appearance): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_appearance', { appearance: value });
}

export interface InstallAppearanceControlOptions {
  readonly store?: AppearanceStore;
  /** 差し替え口。既定は Tauri へ伝える。 */
  readonly setNativeTheme?: (value: Appearance) => void | Promise<void>;
}

/**
 * 判定カラムの**見出しの中**に置く。
 *
 * 見出しの中なのは、実行の状態を描き直しても消えないため（`renderSession` は見出しを残す）。
 * 3 カラムの中身は検証のためのものなので、設定でそこを埋めない。
 */
export function installAppearanceControl(
  root: HTMLElement,
  options: InstallAppearanceControlOptions = {},
): void {
  const store = options.store ?? defaultStore();
  const setNativeTheme = options.setNativeTheme ?? setNativeThemeViaTauri;
  const doc = root.ownerDocument;

  const heading = root.querySelector<HTMLElement>('[data-column-id="verdict"] .column-heading');
  if (heading === null) {
    // 握り潰さない。カラムの構成を変えたときに、静かに消えるのを防ぐ。
    throw new Error('判定カラムの見出しが画面に無い');
  }
  heading.querySelector('.appearance')?.remove();

  const group = doc.createElement('div');
  group.className = 'appearance';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', t('appearance.label'));

  const buttons = new Map<Appearance, HTMLButtonElement>();

  const select = (value: Appearance, remember: boolean): void => {
    applyAppearance(doc, value);
    for (const [key, button] of buttons) {
      button.setAttribute('aria-pressed', String(key === value));
    }
    if (remember) saveAppearance(value, store);
    // 枠は OS が描く。伝えられなくても、ページの中の切り替えは効いている。
    void Promise.resolve(setNativeTheme(value)).catch((error: unknown) => {
      console.error('[appearance] ウィンドウの外観を切り替えられない', error);
    });
  };

  for (const value of APPEARANCES) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'appearance-option';
    button.dataset['appearance'] = value;
    button.textContent = t(LABELS[value]);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      select(value, true);
    });
    buttons.set(value, button);
    group.append(button);
  }

  heading.append(group);
  select(loadAppearance(store), false);
}
