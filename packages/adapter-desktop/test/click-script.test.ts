import { describe, expect, it } from 'vitest';

import { clickScript, NOT_FRONT_MARK } from '../src/click.js';

/**
 * **2026-09-07、押してから動くまで 3 秒かかっていた。**
 *
 * 「ボタンをぽちぽち押すと、反応したのかしなかったのか、遅延しているのか
 * みたいな動きをする」。osascript が 1 回 250 ms 前後かかるのに、
 * **1 押しで 4 回**呼んでいた（中身を出す・前面へ出す・前面か確かめる・押す）。
 * **1 本にまとめる。**
 */
describe('clickScript', () => {
  it('前面に出して、出るのを待って、押すまでを 1 本でやる', () => {
    const script = clickScript('Electron', 100, 200);

    expect(script).toContain('activate');
    expect(script).toContain('click at {100, 200}');
    // **待たずに確かめると、出る前に断ってしまう**（2026-09-07 に踏んだ）。
    expect(script).toContain('delay');
  });

  it('前面に出なかったときは、押さずに目印を返す', () => {
    const script = clickScript('Electron', 1, 2);

    expect(script).toContain(NOT_FRONT_MARK);
  });

  it('アプリ名は閉じて渡す（日本語も引用符も落とさない）', () => {
    expect(clickScript('ローカル連動くん', 1, 2)).toContain('"ローカル連動くん"');
    expect(clickScript('a"b', 1, 2)).toContain(String.raw`"a\"b"`);
  });

  it('座標は整数にする（小数を渡すと System Events が受け取らない）', () => {
    expect(clickScript('X', 10.6, 20.4)).toContain('click at {11, 20}');
  });
});

/**
 * **2026-09-07、人に言われた。**
 *
 * > 操作したときに連動くんがいちいち一番うえにくるのはふせげないの？
 *
 * 押すには前面へ出すしかない（画面全体の座標へ送るので、隠れていると別のアプリが受け取る）。
 * **出したあと、元に戻す。**人が見ていた窓を奪ったままにしない。
 * 戻すのを別の osascript にすると 250 ms 増えるので、**同じ script の中でやる。**
 */
describe('clickScript — 押したあと、元の窓へ戻す', () => {
  it('押す前に前面だったアプリを覚えて、押したあと戻す', () => {
    const script = clickScript('Electron', 1, 2);

    expect(script).toContain('set wasFront to name of first process whose frontmost is true');
    expect(script).toContain('set frontmost of process wasFront to true');
  });

  it('元から目的のアプリが前面だったなら、戻さない（無駄に前面へ出し直さない）', () => {
    expect(clickScript('Electron', 1, 2)).toContain('if wasFront is not "Electron"');
  });
});
