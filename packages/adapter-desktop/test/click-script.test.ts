import { describe, expect, it } from 'vitest';

import { NOT_FRONT_MARK, clickScript, restoreFrontScript } from '../src/click.js';

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
    expect(clickScript('テスト計算機', 1, 2)).toContain('"テスト計算機"');
    expect(clickScript('a"b', 1, 2)).toContain(String.raw`"a\"b"`);
  });

  it('座標は整数にする（小数を渡すと System Events が受け取らない）', () => {
    expect(clickScript('X', 10.6, 20.4)).toContain('click at {11, 20}');
  });
});

/**
 * **2026-09-07、人に言われた。**
 *
 * > 操作したときに相手がいちいち一番うえにくるのはふせげないの？
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

/**
 * **開いている選択肢に触れない**（外部レビュー meta-taro/git-qa#32）。
 *
 * > セレクトがライブビューだと操作できないかも
 * > いや、選択肢は出ますよ。**でも押してもすかります**
 *
 * 押すたびに**前面へ出して、押して、前面を戻して**いた。
 * その「出す」と「戻す」が、**開いているものを畳む。**
 *
 * - ネイティブのメニュー（`<select>` は macOS だと `NSMenu`）は `activate` で閉じる
 * - HTML で描いた選択肢でも、**焦点が外れれば閉じる**
 *
 * **2 回目のクリックが届く頃には、もう無い。**
 *
 * **開いている間しか存在しないものは、全部同じ理由で触れない** ——
 * ドロップダウン・補完候補・右クリックのメニュー・確認ダイアログ。
 * **「押したら何が出るか」は、出たものに触れて初めて確かめ切れる。**
 */
describe('clickScript — 開いているものを畳まない（#32）', () => {
  it('既に前面なら、前面へ出し直さない', () => {
    const script = clickScript('メモ', 10, 20);

    // **前面かどうかを見てから出す。**毎回 `activate` すると、メニューが閉じる。
    expect(script).toContain('if wasFront is not "メモ" then');
    const before = script.slice(0, script.indexOf('click at'));
    expect(before).toMatch(/if wasFront is not "メモ" then[\s\S]*activate/);
  });

  /** **既に前面だったなら、戻す必要も無い。**戻す操作そのものが、開いたものを畳む。 */
  it('既に前面だったなら、戻さない', () => {
    const script = clickScript('メモ', 10, 20);
    const after = script.slice(script.indexOf('click at'));

    expect(after).toContain('if wasFront is not "メモ" then');
  });
});

/**
 * **押し続けている間は、前面を戻さない**（外部レビュー meta-taro/git-qa#32）。
 *
 * 人が見ているのは git-qa の窓なので、**1 回目の押しで戻した瞬間、
 * 2 回目の押しで `activate` が起きる** —— そこで開いたものが畳まれる。
 *
 * > **「開く → 選ぶ」の 2 手が続けられません。**
 *
 * **戻す配慮そのものは正しい**（人が見ていた窓を奪わない）。
 * **戻す時機だけを遅らせる** —— 続けて押している間は掴んだまま、
 * 静かになったら戻す。
 */
describe('clickScript — 戻すかどうかを選べる（#32）', () => {
  it('戻さないと決めたら、戻す文を出さない', () => {
    const script = clickScript('メモ', 10, 20, { restore: false });
    const after = script.slice(script.indexOf('click at'));

    expect(after).not.toContain('set frontmost of process wasFront');
  });

  it('既定では、今までどおり戻す', () => {
    const after = clickScript('メモ', 10, 20).slice(
      clickScript('メモ', 10, 20).indexOf('click at'),
    );

    expect(after).toContain('set frontmost of process wasFront');
  });
});

/** **戻す道は、別に呼べる。**押しの外で、静かになってから使う。 */
describe('restoreFrontScript', () => {
  it('覚えていた窓へ戻す', () => {
    expect(restoreFrontScript('Terminal')).toContain('"Terminal"');
  });
});
