/**
 * 設定を覚えておく口。
 *
 * **webview では `localStorage` が使えないことがある**（設定で切られている等）ので、
 * 差し替えられる形にし、**使えなくても落ちない**。覚えないだけで、切り替えは効く。
 */
export interface SettingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function defaultStore(): SettingStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readSetting(key: string, store: SettingStore | undefined): string | undefined {
  try {
    return store?.getItem(key) ?? undefined;
  } catch {
    // 読めないだけ。**既定へ落として動き続ける。**
    return undefined;
  }
}

export function writeSetting(key: string, value: string, store: SettingStore | undefined): void {
  try {
    store?.setItem(key, value);
  } catch {
    // 覚えられないだけで、いまの切り替えは効いている。握り潰す理由はこれ。
  }
}
