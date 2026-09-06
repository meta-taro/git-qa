import { describe, expect, it } from 'vitest';

import runSchema from '../../schema/run.schema.json' with { type: 'json' };
import { HANDLE_RULE, isValidHandle } from '../../src/run/handle.js';

/**
 * 置いた人のハンドル。**証跡の schema が正本**（C18）。
 *
 * **入口で弾かないと、5 件置き終わったあとの保存で落ちる。**実際にそれが起き、
 * 人が実機で置いた 5 件が 2 回とも消えた（2026-09-04）。
 * いちばん高くつく壊れ方なので、同じ規則を入口にも置く。
 *
 * **2026-09-06、日本語のハンドルを使うと人が決めた**（C53）。C45 が「これを止めるべき条件」
 * として挙げていた場合そのもの。**schema（正本）を変え、画面側だけ緩めない。**
 */
describe('isValidHandle', () => {
  it('日本語のハンドルが通る', () => {
    // **人が実際に使っている値。**ここが通らないと検証を始められない。
    expect(isValidHandle('めたたろ')).toBe(true);
    expect(isValidHandle('田中')).toBe(true);
  });

  it('英数字のハンドルも今まで通り通る', () => {
    expect(isValidHandle('metataro')).toBe(true);
    expect(isValidHandle('octo-cat9')).toBe(true);
  });

  it('空は通さない（誰が見たか分からない証跡を作らない）', () => {
    expect(isValidHandle('')).toBe(false);
  });

  it('長すぎるものは通さない（画面に収まらない）', () => {
    expect(isValidHandle('あ'.repeat(39))).toBe(true);
    expect(isValidHandle('あ'.repeat(40))).toBe(false);
  });

  /**
   * **ユーザー入力を信用しない**（product-baseline §21）。
   * いまは置き場所の名前に使っていないが、使われたときに事故る形は最初から通さない。
   */
  it('空白・区切り・制御文字は通さない', () => {
    expect(isValidHandle('めた たろ')).toBe(false);
    expect(isValidHandle('a/b')).toBe(false);
    expect(isValidHandle('a\\b')).toBe(false);
    expect(isValidHandle('..')).toBe(false);
    expect(isValidHandle('.hidden')).toBe(false);
    expect(isValidHandle('a\tb')).toBe(false);
  });

  it('規則は schema から取る（二重に書いて食い違わせない）', () => {
    const pattern = (runSchema as { $defs: { handle: { pattern: string } } }).$defs.handle.pattern;

    expect(HANDLE_RULE.source).toBe(pattern);
  });
});
