import { describe, expect, it } from 'vitest';

import { findInOcr, parseOcr } from '../src/ocr.js';

/**
 * **2026-09-08、人に言われた。**
 *
 * > カレンダー？カレンダーならかぶっちゃだめでしょ。
 *
 * 指す矢印が、指した文字の上に載っていた。**押した物が見えないと意味が無い。**
 * 外へ置くには**その文字の大きさ**が要る。中心しか返していなかった。
 */
describe('parseOcr — 大きさ', () => {
  it('大きさも読む', () => {
    expect(parseOcr('カレンダー\t880\t67\t72\t18')).toEqual([
      { text: 'カレンダー', x: 880, y: 67, width: 72, height: 18 },
    ]);
  });

  /** **古い道具は 3 つしか返さない。**大きさが無くても捨てない（指す所は分かる）。 */
  it('大きさが無くても読む', () => {
    expect(parseOcr('カレンダー\t880\t67')).toEqual([{ text: 'カレンダー', x: 880, y: 67 }]);
  });

  it('大きさが数でなければ、無いものとして扱う', () => {
    expect(parseOcr('あ\t1\t2\tx\ty')).toEqual([{ text: 'あ', x: 1, y: 2 }]);
  });
});

describe('findInOcr — 大きさ', () => {
  it('見つけたものの大きさも返す', () => {
    const at = findInOcr(
      [{ text: 'カレンダー', x: 880, y: 67, width: 72, height: 18 }],
      'カレンダー',
    );

    expect(at).toEqual({ x: 880, y: 67, width: 72, height: 18 });
  });
});
