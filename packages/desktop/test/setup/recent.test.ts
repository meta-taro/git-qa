// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { readRecentSheets, rememberSheet, writeRecentSheets } from '../../src/setup/recent.js';
import type { SettingStore } from '../../src/setting-store.js';

/**
 * **最近開いた検証シート。**
 *
 * 2026-09-04、人が一覧を見て「セキュリティ上とか、印象が悪い」。ホームの下を漁るのをやめた
 * （`sheetSearchRoots`）。**代わりに、その人が実際に開いたものを覚えて出す。**
 * 探索しないので、無関係な案件のパスは出ない。
 */
const memory = (initial?: string): SettingStore => {
  const box = new Map<string, string>();
  if (initial !== undefined) box.set('git-qa.recentSheets', initial);
  return {
    getItem: (key) => box.get(key) ?? null,
    setItem: (key, value) => void box.set(key, value),
  };
};

describe('rememberSheet', () => {
  it('いちばん新しいものが先頭に来る', () => {
    expect(rememberSheet(['/a.tsv'], '/b.tsv', 5)).toEqual(['/b.tsv', '/a.tsv']);
  });

  it('同じものは重複させず、先頭へ上げる', () => {
    expect(rememberSheet(['/a.tsv', '/b.tsv'], '/b.tsv', 5)).toEqual(['/b.tsv', '/a.tsv']);
  });

  it('決めた数で切る', () => {
    expect(rememberSheet(['/a.tsv', '/b.tsv', '/c.tsv'], '/d.tsv', 3)).toEqual([
      '/d.tsv',
      '/a.tsv',
      '/b.tsv',
    ]);
  });
});

describe('readRecentSheets', () => {
  it('覚えていないときは空', () => {
    expect(readRecentSheets(memory())).toEqual([]);
  });

  it('覚えたものを読み返せる', () => {
    const store = memory();
    writeRecentSheets(store, ['/a.tsv', '/b.tsv']);

    expect(readRecentSheets(store)).toEqual(['/a.tsv', '/b.tsv']);
  });

  it('壊れていても落ちない（覚えていないものとして扱う）', () => {
    // **設定が壊れているだけで、人の作業を止めない。**
    expect(readRecentSheets(memory('{壊れている'))).toEqual([]);
  });

  it('配列でないものを覚えていたら、無視する', () => {
    expect(readRecentSheets(memory('"/a.tsv"'))).toEqual([]);
  });

  it('文字列でない要素は落とす', () => {
    expect(readRecentSheets(memory('["/a.tsv", 3, null]'))).toEqual(['/a.tsv']);
  });

  it('store が無くても落ちない', () => {
    expect(readRecentSheets(undefined)).toEqual([]);
    expect(() => writeRecentSheets(undefined, ['/a.tsv'])).not.toThrow();
  });
});
