import { describe, expect, it } from 'vitest';

import { scrollScript } from '../src/click.js';

/**
 * **2026-09-07、人に言われた。**
 *
 * > 中スクロールがきかないっすね
 *
 * **一度も効いていなかった。**ログに 22 回、同じものが並んでいた。
 *
 *   osascript が失敗した: syntax error:
 *   このscroll(0, -31)の後にat:{957, 729}を書くことはできません。 (-2740)
 *
 * `System Events` に `scroll` という命令は無い。**書けるつもりで書いてあった。**
 * 検査が無く、実行時にしか分からない形だったので、ここまで残った。
 */
describe('scrollScript', () => {
  it('滑車の出来事を作って送る', () => {
    const script = scrollScript('Electron', 100, 200, 3);

    expect(script).toContain('CGEventCreateScrollWheelEvent2');
    expect(script).toContain('CGEventPost');
  });

  it('先に指の位置を運ぶ（滑車は、いま指が乗っている窓へ届く）', () => {
    const script = scrollScript('Electron', 100, 200, 3);

    expect(script).toContain('CGEventCreateMouseEvent');
    expect(script).toContain('100');
    expect(script).toContain('200');
  });

  it('人が上へなぞったら、中身は下へ送る', () => {
    // なぞった量が正（上へなぞった）＝ 先を見たい ＝ 滑車は負。
    expect(scrollScript('X', 1, 2, 5)).toContain('-5');
    expect(scrollScript('X', 1, 2, -5)).toContain(', 5,');
  });

  it('アプリ名は閉じて渡す', () => {
    expect(scrollScript('ローカル連動くん', 1, 2, 1)).toContain('"ローカル連動くん"');
  });
});
