import { describe, expect, it } from 'vitest';

import { dragScript, scrollScript } from '../src/click.js';

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
    expect(scrollScript('テスト計算機', 1, 2, 1)).toContain('"テスト計算機"');
  });
});

/**
 * **掴んで運ぶ（DnD）。2026-09-07 まで実装が無かった。**
 *
 * > クリックのたびに相手が前面に来るので、DnDもできないことになる
 *
 * 押すのは AX の要素を直接押せるので前面に出さずに済む（`git-qa-input`）。
 * **なぞる・掴んで運ぶには、その口が無い**（`AXScrollArea` に
 * スクロールバーも `AXValue` も出ていない・実測）。実際のマウス操作を送るしかない。
 *
 * ただし**1 回の操作で 1 回だけ前面に出す。**押して・運んで・離すまでを 1 本の script
 * でやる。**途中で焦点が動くと、掴んだものが落ちる。**
 */
describe('dragScript', () => {
  it('押して・運んで・離すまでを 1 本でやる', () => {
    const script = dragScript('Electron', 10, 20, 30, 40);

    expect(script).toContain('CGEventCreateMouseEvent');
    // 1 = 押す / 6 = 押したまま動かす / 2 = 離す
    expect(script).toContain('LEFT_DOWN');
    expect(script).toContain('LEFT_DRAGGED');
    expect(script).toContain('LEFT_UP');
  });

  it('途中を何回かに分けて運ぶ（一足飛びだと受け取らない相手がいる）', () => {
    const script = dragScript('Electron', 0, 0, 100, 100);

    expect(script).toContain('STEPS');
  });

  it('終わったら元の窓へ戻す', () => {
    expect(dragScript('Electron', 1, 2, 3, 4)).toContain('wasFront');
  });

  it('アプリ名は閉じて渡す', () => {
    expect(dragScript('テスト計算機', 1, 2, 3, 4)).toContain('"テスト計算機"');
  });
});
