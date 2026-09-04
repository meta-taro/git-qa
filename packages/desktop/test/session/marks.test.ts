import { describe, expect, it } from 'vitest';

import { markFor } from '../../src/session/marks.js';

/**
 * 判定の記号。
 *
 * **色が付くのは「人が見たもの」だけ。**AI が通しただけの `AUTO_PASS` は無彩色にする。
 * 一覧を眺めただけで「人が見た所」と「AI が言っただけの所」が分かる状態にしておく
 * —— それがこの製品の芯（C1 / C17）だから。
 *
 * 2026-09-04、実物を触った人の要望:「ケースのほうも色とアイコン？記号？とかがよいかと」「🟢とかね」。
 */
describe('markFor', () => {
  it('人が見たものは色が付く', () => {
    expect(markFor('VERIFIED')).toBe('🟢');
    expect(markFor('FAIL')).toBe('🔴');
    expect(markFor('BLOCKED')).toBe('🟡');
  });

  it('AI が通しただけのものは色を持たない', () => {
    // **ここが色付きになったら、この製品は意味を失う。**
    expect(markFor('AUTO_PASS')).toBe('⚪');
  });

  it('見送ったものは、丸ではなく四角', () => {
    expect(markFor('SKIP')).toBe('⬜');
  });

  it('まだ確定していないものは、埋めない', () => {
    // **空欄は空欄のまま**（product-baseline §19）。
    expect(markFor(undefined)).toBe('');
  });

  it('知らない値が来ても落ちない', () => {
    expect(markFor('NOPE')).toBe('');
  });
});
