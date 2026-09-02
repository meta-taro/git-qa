import { defaultStore, readSetting, writeSetting } from '../setting-store.js';
import type { SettingStore } from '../setting-store.js';
import { LOCALES, resolveLocale } from './locale.js';
import type { Locale } from './locale.js';

/**
 * 言語の切り替え（Issue 011）。
 *
 * **入口はメニュー**（`src-tauri/src/menu.rs`）。OS に従うだけだと、使う人が選べない。
 * **覚えるのは画面側**で、次に開いたときに効かせる。
 */

export type LocaleChoice = 'system' | Locale;

const STORAGE_KEY = 'git-qa.locale';

const isChoice = (value: string): value is LocaleChoice =>
  value === 'system' || (LOCALES as readonly string[]).includes(value);

/**
 * 実際に出す言語。
 *
 * `system` のときの判定は**画面側が持つ**。`navigator.languages` のほうが、
 * Rust から見える環境変数より確か（GUI アプリでは `LANG` が入っていないことがある）。
 */
export function effectiveLocale(choice: LocaleChoice, languages: readonly string[]): Locale {
  return choice === 'system' ? resolveLocale(languages) : choice;
}

/** メニューと画面をつなぐ口。 */
export interface LocaleBridge {
  notify(choice: LocaleChoice, effective: Locale): Promise<void>;
  subscribe(handler: (choice: LocaleChoice) => void): Promise<() => void>;
}

/** 本物の Tauri へ繋ぐ。**ブラウザで開いているときは `undefined`。** */
export function tauriLocaleBridge(): LocaleBridge | undefined {
  if (!('__TAURI_INTERNALS__' in window)) return undefined;
  return {
    async notify(choice, effective) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_locale', { choice, effective });
    },
    async subscribe(handler) {
      const { listen } = await import('@tauri-apps/api/event');
      return listen<string>('locale', (event) => {
        handler(isChoice(event.payload) ? event.payload : 'system');
      });
    },
  };
}

export interface LocaleSyncOptions {
  readonly store?: SettingStore | undefined;
  readonly bridge?: LocaleBridge | undefined;
  readonly languages?: readonly string[];
  /** 言語が決まったとき / 変わったときに呼ぶ。**画面を描き直す。** */
  readonly onChange: (locale: Locale) => void;
}

export function loadLocaleChoice(store: SettingStore | undefined): LocaleChoice {
  const raw = readSetting(STORAGE_KEY, store) ?? '';
  return isChoice(raw) ? raw : 'system';
}

/**
 * 覚えている言語を当て、以後はメニューからの知らせに従う。
 */
export async function startLocaleSync(options: LocaleSyncOptions): Promise<void> {
  const store = 'store' in options ? options.store : defaultStore();
  const bridge = 'bridge' in options ? options.bridge : tauriLocaleBridge();
  const languages = options.languages ?? navigator.languages;

  const apply = (choice: LocaleChoice): Locale => {
    const effective = effectiveLocale(choice, languages);
    options.onChange(effective);
    return effective;
  };

  await bridge?.subscribe((choice) => {
    // 知らない値は「システムに従う」へ落とす。黙って別の言語にしない。
    const safe: LocaleChoice = isChoice(choice) ? choice : 'system';
    apply(safe);
    writeSetting(STORAGE_KEY, safe, store);
  });

  const current = loadLocaleChoice(store);
  const effective = apply(current);
  // 覚えている値を伝える。**伝えないと、メニューの文言とチェックが前回の選択とずれる。**
  await bridge?.notify(current, effective);
}
