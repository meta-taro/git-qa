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

/**
 * メニューと画面をつなぐ口。
 *
 * **切り替えの入口はメニュー**（`src-tauri/src/menu.rs`）。設定を 3 カラムの中に置くと、
 * 検証のための場所が設定で埋まる。**覚えるのは画面側**で、次に開いたときに効かせる。
 */
export interface AppearanceBridge {
  /** いまの選択を Rust へ知らせる（ウィンドウの外観とメニューのチェックを揃える）。 */
  notify(value: Appearance): Promise<void>;
  /** メニューで選ばれたことを受け取る。戻り値を呼ぶと解除。 */
  subscribe(handler: (value: Appearance) => void): Promise<() => void>;
}

/**
 * 本物の Tauri へ繋ぐ。
 *
 * **ブラウザで開いているとき**（`pnpm --filter @git-qa/desktop dev`）は Tauri がいないので
 * `undefined` を返す。ここで落とすと、ブラウザでは画面が出なくなる。
 */
export function tauriAppearanceBridge(): AppearanceBridge | undefined {
  if (!('__TAURI_INTERNALS__' in window)) return undefined;
  return {
    async notify(value) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_appearance', { appearance: value });
    },
    async subscribe(handler) {
      const { listen } = await import('@tauri-apps/api/event');
      return listen<string>('appearance', (event) => {
        handler(isAppearance(event.payload) ? event.payload : 'system');
      });
    },
  };
}

export interface AppearanceSyncOptions {
  readonly doc?: Document;
  readonly store?: AppearanceStore;
  /** 差し替え口。既定は Tauri。**Tauri がいなければ画面の中だけ切り替わる。** */
  readonly bridge?: AppearanceBridge | undefined;
}

/**
 * 覚えている外観を当て、以後はメニューからの知らせに従う。
 */
export async function startAppearanceSync(options: AppearanceSyncOptions = {}): Promise<void> {
  const doc = options.doc ?? document;
  const store = options.store ?? defaultStore();
  const bridge = 'bridge' in options ? options.bridge : tauriAppearanceBridge();

  const current = loadAppearance(store);
  applyAppearance(doc, current);

  await bridge?.subscribe((value) => {
    applyAppearance(doc, value);
    saveAppearance(value, store);
  });

  // 覚えている値を伝える。**伝えないと、メニューのチェックと枠が前回の選択とずれる。**
  await bridge?.notify(current);
}
