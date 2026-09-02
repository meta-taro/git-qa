import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../src/i18n/index.js';
import { COLUMNS, mainColumn, MAIN_COLUMN_ID, type Column } from '../src/columns.js';

describe('COLUMNS', () => {
  it('カラムは 3 つで、左からケース・ライブビュー・判定の順に並ぶ', () => {
    expect(COLUMNS.map((column) => column.id)).toEqual(['cases', 'live', 'verdict']);
  });

  it('id が重複しない', () => {
    expect(new Set(COLUMNS.map((column) => column.id)).size).toBe(COLUMNS.length);
  });

  it('見出しと空のときの文言が、どのカラムにも入っている', () => {
    // **鍵がカタログに在ることまで見る。**在ることだけを見ると、訳し漏れを取り逃がす。
    for (const column of COLUMNS) {
      expect(MESSAGES.ja[column.headingKey]).toBeTruthy();
      expect(MESSAGES.ja[column.placeholderKey]).toBeTruthy();
      expect(MESSAGES.en[column.headingKey]).toBeTruthy();
      expect(MESSAGES.en[column.placeholderKey]).toBeTruthy();
    }
  });

  /**
   * C4 / PRD §2 — この製品の主媒体はライブビュー。
   * 中央が左右より狭くなる変更は、見た目の調整ではなく製品の前提を崩す変更なので、
   * ここで落とす。
   */
  it('ライブビューが左右のどちらよりも広い', () => {
    const live = mainColumn();
    const others = COLUMNS.filter((column) => column.id !== MAIN_COLUMN_ID);

    expect(others).toHaveLength(2);
    for (const column of others) {
      expect(live.flex).toBeGreaterThan(column.flex);
    }
  });

  it('幅の取り分は全て正の数', () => {
    for (const column of COLUMNS) {
      expect(column.flex).toBeGreaterThan(0);
    }
  });
});

describe('mainColumn', () => {
  it('主媒体のカラムを返す', () => {
    expect(mainColumn().id).toBe(MAIN_COLUMN_ID);
  });

  it('構成から主媒体が抜けていたら落ちる', () => {
    const withoutLive: readonly Column[] = COLUMNS.filter((column) => column.id !== MAIN_COLUMN_ID);

    expect(() => mainColumn(withoutLive)).toThrow(/live/);
  });
});
