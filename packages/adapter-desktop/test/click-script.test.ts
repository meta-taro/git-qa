import { describe, expect, it } from 'vitest';

import { clickScript } from '../src/click.js';

/**
 * **2026-09-07、人にこう言われた。**
 *
 * > 操作したときに連動くんがいちいち一番うえにくるのはふせげないの？
 * > うーん、おしいw一瞬上にきて引っ込むねw
 *
 * 前面に出していたのは、`click at {x, y}` が**画面の座標へ**送るからだった。
 * 隠れていれば手前の別アプリが受け取る（実際に Chrome のツールバーと warifu を押した）。
 *
 * **宛先をアプリにすれば、その必要が無くなる。**
 * `CGEventPostToPid` は、指定したプロセスにだけ出来事を届ける。
 * 前面に出さない・並び順を気にしない・元の窓を戻す必要もない。
 */
describe('clickScript', () => {
  it('プロセスを名指しして届ける（画面へばら撒かない）', () => {
    const script = clickScript(1398, 100, 200);

    expect(script).toContain('CGEventPostToPid');
    expect(script).toContain('1398');
  });

  it('押して離すまでを送る（押しっぱなしにしない）', () => {
    const script = clickScript(1, 2, 3);

    // 1 = leftMouseDown, 2 = leftMouseUp
    expect(script).toContain('kCGEventLeftMouseDown');
    expect(script).toContain('kCGEventLeftMouseUp');
  });

  it('前面に出す指示を含まない（そこが直したところ）', () => {
    const script = clickScript(1398, 1, 2);

    expect(script).not.toContain('activate');
    expect(script).not.toContain('frontmost');
  });

  it('座標は整数にする', () => {
    expect(clickScript(1, 10.6, 20.4)).toContain('11');
    expect(clickScript(1, 10.6, 20.4)).toContain('20');
  });
});
