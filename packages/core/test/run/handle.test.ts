import { describe, expect, it } from 'vitest';

import { HANDLE_RULE, isValidHandle } from '../../src/run/handle.js';

/**
 * 置いた人のハンドル。**証跡の schema が正本**（C18）で、そこは ASCII に限っている。
 *
 * **入口で弾かないと、5 件置き終わったあとの保存で落ちる。**実際にそれが起き、
 * 人が実機で置いた 5 件が 2 回とも消えた（2026-09-04）。
 * いちばん高くつく壊れ方なので、同じ規則を入口にも置く。
 */
describe('isValidHandle', () => {
  it('英数字のハンドルは通る', () => {
    expect(isValidHandle('metataro')).toBe(true);
    expect(isValidHandle('octo-cat9')).toBe(true);
  });

  it('日本語は通さない（schema が弾く）', () => {
    expect(isValidHandle('めたたろ')).toBe(false);
  });

  it('空・記号・長すぎるものも通さない', () => {
    expect(isValidHandle('')).toBe(false);
    expect(isValidHandle('-leading')).toBe(false);
    expect(isValidHandle('a@b')).toBe(false);
    expect(isValidHandle('a'.repeat(40))).toBe(false);
  });

  it('規則は schema から取る（二重に書いて食い違わせない）', () => {
    expect(HANDLE_RULE.source).toContain('A-Za-z0-9');
  });
});
