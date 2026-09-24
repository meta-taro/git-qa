import { describe, expect, it } from 'vitest';

import { alreadyThereMessage, wasAlreadyThere } from '../../src/run/already-there.js';
import { planExpectation } from '../../src/run/steps.js';

/**
 * **押す前から在る文字を、期待結果に書けてしまう**（2026-09-24・人の指示）。
 *
 * > この指摘をずっとしています。3 回以上。
 *
 * **同じ日に、同じ相手が 3 回、同じ雑さでシートを書いた。**
 * 期待結果は `「X」と表示される` だけで、**在るか、しか見ない。**
 * **押す前から在る文字を書くと、何も起きなくても通る。**
 *
 * **文書に書くだけでは止まらない**（3 回書いて 3 回踏んだ）。
 * **機械で止める** —— 押す前の画面にも在ったなら、**それは何も確かめていない。**
 */
describe('wasAlreadyThere', () => {
  const expectation = planExpectation('「日本語」と表示される');

  it('押す前から在った文字は、確かめたことにならない', () => {
    expect(wasAlreadyThere(expectation, '英語 日本語 韓国語')).toBe(true);
  });

  it('押したあとに出た文字なら、確かめている', () => {
    expect(wasAlreadyThere(expectation, 'English のみ')).toBe(false);
  });

  it('押す前の画面が読めなかったときは、止めない（読めないことを落第にしない）', () => {
    expect(wasAlreadyThere(expectation, undefined)).toBe(false);
  });

  /** 見る文字を決められない期待（hold）は、そもそもここへ来ない。 */
  it('文字を見ない期待では、止めない', () => {
    expect(wasAlreadyThere(planExpectation('うまくいく'), 'なんでも')).toBe(false);
  });
});

describe('alreadyThereMessage', () => {
  it('何が起きたかと、どう直すかを言う', () => {
    const said = alreadyThereMessage('日本語');

    expect(said).toContain('日本語');
    expect(said).toMatch(/押す前/);
    // **どう直すかまで言う。**「駄目です」だけだと、人はシートを眺めることになる。
    expect(said).toMatch(/押したあとに出る|変わった/);
  });
});
