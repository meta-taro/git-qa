import { DEFAULT_LOCALE, createTranslator } from './locale.js';
import type { Locale, Translate } from './locale.js';

/**
 * いま使う言語。**画面全体で 1 つ**。
 *
 * 起動時に 1 度だけ決める（`main.ts`）。既定は日本語で、決める前に描いても
 * 英語にはならない（**日本語の利用者が英語の画面を見るのが一番まずい**）。
 */

let current: Translate = createTranslator(DEFAULT_LOCALE);
let currentLocale: Locale = DEFAULT_LOCALE;

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  current = createTranslator(locale);
}

export function locale(): Locale {
  return currentLocale;
}

export const t: Translate = (key, params) => current(key, params);
