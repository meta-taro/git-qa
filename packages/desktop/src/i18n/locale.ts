import { MESSAGES } from './messages.js';

/**
 * どの言語で出すかを 1 箇所で決める。
 *
 * **既定は日本語。**使う人が日本語で、検証シートも日本語だから。
 * 対応していない言語のときに英語へ落とすと、**日本語の利用者が英語の画面を見る**ことになる。
 */

export const LOCALES = ['ja', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ja';

const isLocale = (value: string): value is Locale => (LOCALES as readonly string[]).includes(value);

/** `ja-JP` → `ja`。地域差は今のところ持たない。 */
const primary = (tag: string): string => (tag.split('-')[0] ?? '').toLowerCase();

/**
 * @param candidates OS が返す言語の並び（`navigator.languages` 等）。前にあるものが優先。
 * @param override 明示の指定（`GIT_QA_LANG` / `?lang=`）。**読めなければ無視する。**
 */
export function resolveLocale(candidates: readonly string[], override?: string): Locale {
  if (override !== undefined && isLocale(primary(override))) return primary(override) as Locale;

  for (const candidate of candidates) {
    const code = primary(candidate);
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}

export type Translate = (
  key: keyof (typeof MESSAGES)['ja'],
  params?: Record<string, string>,
) => string;

/**
 * 文言を引く。差し込みは `{name}`。
 *
 * **値が来ていない差し込みは、印をそのまま残す。**空にすると「文言が変」なのか
 * 「値が来ていない」のかが人に分からない。
 */
export function createTranslator(locale: Locale): Translate {
  const catalog = MESSAGES[locale];
  return (key, params) => {
    const template: string = catalog[key];
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole);
  };
}
