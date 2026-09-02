import { describe, expect, it } from 'vitest';

import { MESSAGES, createTranslator, resolveLocale } from '../../src/i18n/index.js';

/**
 * 文言を 1 箇所に集める。**画面にハードコードした日本語を残さない。**
 * 残すと、後から言語を足すときに「どこにあるか分からない」状態になる。
 */

describe('resolveLocale', () => {
  it('OS の言語が日本語なら日本語', () => {
    expect(resolveLocale(['ja-JP', 'en-US'])).toBe('ja');
  });

  it('OS の言語が英語なら英語', () => {
    expect(resolveLocale(['en-GB'])).toBe('en');
  });

  it('対応していない言語なら日本語に落とす（既定は日本語）', () => {
    expect(resolveLocale(['fr-FR', 'de-DE'])).toBe('ja');
  });

  it('対応している言語が後ろにあれば、それを採る', () => {
    expect(resolveLocale(['fr-FR', 'en-US'])).toBe('en');
  });

  it('明示の指定が最優先（検証と確認のため）', () => {
    expect(resolveLocale(['ja-JP'], 'en')).toBe('en');
  });

  it('明示の指定が読めなければ、OS の言語に戻る（黙って英語にしない）', () => {
    expect(resolveLocale(['ja-JP'], 'ねこ')).toBe('ja');
  });

  it('言語の情報が何も無ければ日本語', () => {
    expect(resolveLocale([])).toBe('ja');
  });
});

describe('createTranslator', () => {
  it('言語ごとの文言を返す', () => {
    expect(createTranslator('ja')('column.cases.heading')).toBe('ケース');
    expect(createTranslator('en')('column.cases.heading')).toBe('Cases');
  });

  it('差し込みができる', () => {
    const t = createTranslator('ja');
    expect(t('verdict.ai', { result: 'PASS' })).toContain('PASS');
  });

  it('差し込みの値が無ければ、印を残す（黙って空にしない）', () => {
    const t = createTranslator('ja');
    // 空にすると「文言が変」なのか「値が来ていない」のか分からなくなる。
    expect(t('verdict.ai', {})).toContain('{result}');
  });
});

describe('カタログ', () => {
  it('日本語と英語で、鍵の集合が同じ（訳し漏れをここで捕まえる）', () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.ja).sort());
  });

  it('空の文言を持たない', () => {
    for (const [locale, catalog] of Object.entries(MESSAGES)) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value, `${locale}.${key}`).not.toBe('');
      }
    }
  });
});
