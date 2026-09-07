import { describe, expect, it } from 'vitest';

import { keyCap } from '../../src/session/keys.js';

/**
 * **2026-09-07、人に言われた。**
 *
 * > あとあろうアプとかなぜえいごですか？記号ではだめなの？
 *
 * 画面に `ArrowUp` と出していた。**あれはブラウザの内部の名前**で、
 * 人に見せる名前ではない。キーボードに刻まれているのは `↑`。
 */
describe('keyCap', () => {
  it('矢印は矢印で見せる', () => {
    expect(keyCap('ArrowUp')).toBe('↑');
    expect(keyCap('ArrowDown')).toBe('↓');
    expect(keyCap('ArrowLeft')).toBe('←');
    expect(keyCap('ArrowRight')).toBe('→');
  });

  it('空白キーは日本語で言う', () => {
    expect(keyCap(' ')).toBe('スペース');
  });

  it('1 文字のキーは大文字で見せる（キーボードの刻印に合わせる）', () => {
    expect(keyCap('d')).toBe('D');
    expect(keyCap('f')).toBe('F');
  });
});
