import { describe, expect, it } from 'vitest';

import { findInOcr, parseOcr } from '../src/ocr.js';

/**
 * 触れ方の**段 2** —— 絵から文字を読む（C55）。
 *
 * **段 1（アクセシビリティ）が空でも諦めないための道。**自分で画面を描くアプリは
 * 部品を何も名乗らないが、**人が読める文字は画面に出ている。**そこを読む。
 *
 * **読み違える前提で作る。**実測（2026-09-06）で `書きました` を `響きました` と読んだ。
 * ただし外れる方向は安全 —— 期待した文字が「見つからない」になり、人の目に回る。
 */

describe('parseOcr', () => {
  it('文字と位置を 1 行ずつ読む', () => {
    const stdout = ['保存\t120\t340', '保存しました\t80\t400'].join('\n');

    expect(parseOcr(stdout)).toEqual([
      { text: '保存', x: 120, y: 340 },
      { text: '保存しました', x: 80, y: 400 },
    ]);
  });

  it('半端な行は捨てる（欠けた値で触らない）', () => {
    expect(parseOcr('保存\t120')).toEqual([]);
    expect(parseOcr('')).toEqual([]);
    expect(parseOcr('保存\tあ\tい')).toEqual([]);
  });
});

describe('findInOcr', () => {
  const lines = [
    { text: '保存しました', x: 80, y: 400 },
    { text: '保存', x: 120, y: 340 },
  ];

  it('完全に一致するものを先に選ぶ', () => {
    expect(findInOcr(lines, '保存')).toEqual({ x: 120, y: 340 });
  });

  it('完全一致が無ければ、含むものを選ぶ', () => {
    expect(findInOcr(lines, '保存し')).toEqual({ x: 80, y: 400 });
  });

  it('見つからなければ undefined（座標へ降りる前に、人へ返すため）', () => {
    expect(findInOcr(lines, '削除')).toBeUndefined();
  });

  /**
   * OCR は空白や記号を混ぜて読む。**そこで落とすと、人は毎回シートを直すことになる。**
   * 実測で `1.引き受けること／引き受けないことー` のように余計な字が付いた。
   */
  it('空白の違いは気にしない', () => {
    expect(findInOcr([{ text: ' 保 存 ', x: 10, y: 20 }], '保存')).toEqual({ x: 10, y: 20 });
  });
});
