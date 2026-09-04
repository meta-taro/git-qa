import { readSetting, writeSetting } from '../setting-store.js';
import type { SettingStore } from '../setting-store.js';

/**
 * 最近開いた検証シート。
 *
 * **ホームの下を漁るのをやめた代わりの口**（`sheetSearchRoots` に理由がある）。
 * その人が実際に開いたものだけを覚えるので、**無関係な案件のパスは出ない。**
 */
const KEY = 'git-qa.recentSheets';

/** 一覧に出す数。**少し出す。** */
export const RECENT_LIMIT = 5;

export function rememberSheet(
  recent: readonly string[],
  path: string,
  limit: number = RECENT_LIMIT,
): string[] {
  return [path, ...recent.filter((known) => known !== path)].slice(0, limit);
}

export function readRecentSheets(store: SettingStore | undefined): string[] {
  const raw = readSetting(KEY, store);
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    // 設定が壊れているだけ。**覚えていないものとして続ける。**
    return [];
  }
}

export function writeRecentSheets(store: SettingStore | undefined, list: readonly string[]): void {
  writeSetting(KEY, JSON.stringify(list), store);
}
