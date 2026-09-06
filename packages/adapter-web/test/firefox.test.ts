import { describe, expect, it } from 'vitest';

import { firefoxArgs, parseBidiUrl, pointerActions, typeActions } from '../src/firefox.js';

/**
 * Firefox で見る（Issue 018 / C56）。
 *
 * **Chrome とは別の約束。**Firefox は 129 で CDP を捨てているので、
 * 新しい Firefox で動くには WebDriver BiDi しか無い。
 *
 * ここに置くのは「どう起こすか」「どう触るか」を決める所だけ。
 * 実際に起こすのは配線なので検査していない。
 */

describe('firefoxArgs', () => {
  it('繋ぎ口を開けて、人のプロファイルを触らない場所で起こす', () => {
    const args = firefoxArgs({ port: 0, profileDir: '/tmp/git-qa-ff-1' });

    expect(args).toContain('--remote-debugging-port');
    expect(args).toContain('0');
    // **人の Firefox を乗っ取らない。**開いているタブや履歴に触れる場所で起こさない。
    expect(args).toContain('--profile');
    expect(args).toContain('/tmp/git-qa-ff-1');
  });

  it('画面を人に見せる（見えない描画で判断させない・C54）', () => {
    expect(firefoxArgs({ port: 0, profileDir: '/tmp/x' })).not.toContain('--headless');
  });

  it('大きさを指定できる（同じ幅で見ないと、崩れの有無が比べられない）', () => {
    const args = firefoxArgs({ port: 0, profileDir: '/tmp/x', size: { width: 1280, height: 900 } });

    expect(args).toContain('--window-size');
    expect(args).toContain('1280,900');
  });
});

/**
 * 起こした Firefox は、繋ぎ先を**標準エラーに 1 行**書く。
 * **CDP のときとは文言が違う**（`WebDriver BiDi listening on ws://…`）。
 */
describe('parseBidiUrl', () => {
  it('繋ぎ先の 1 行を読む', () => {
    expect(parseBidiUrl('WebDriver BiDi listening on ws://127.0.0.1:52341')).toBe(
      'ws://127.0.0.1:52341',
    );
  });

  it('前後に別の行が混ざっていても読む', () => {
    const out = ['*** something', 'WebDriver BiDi listening on ws://127.0.0.1:9', 'more'].join(
      '\n',
    );

    expect(parseBidiUrl(out)).toBe('ws://127.0.0.1:9');
  });

  /**
   * **古い Firefox の 1 行を掴まない。**89 は `DevTools listening on ws://…` を出すが、
   * それは CDP で、BiDi ではない。掴むと、繋いだ先で命令が全部断られる。
   */
  it('CDP の 1 行は読まない（古い Firefox で誤って繋がない）', () => {
    expect(parseBidiUrl('DevTools listening on ws://localhost:9333/devtools/browser/abc')).toBe(
      undefined,
    );
  });

  it('まだ出ていなければ undefined（当て推量で繋がない）', () => {
    expect(parseBidiUrl('')).toBeUndefined();
  });
});

/** BiDi の入力は「動きの並び」で送る。CDP のように 1 命令ずつではない。 */
describe('pointerActions', () => {
  it('動かして、押して、離す', () => {
    const actions = pointerActions({ x: 12, y: 34 });
    const list = actions[0]?.actions ?? [];

    expect(list.map((a) => a.type)).toEqual(['pointerMove', 'pointerDown', 'pointerUp']);
    expect(list[0]).toMatchObject({ x: 12, y: 34 });
  });
});

describe('typeActions', () => {
  it('1 文字ずつ、押して離す', () => {
    const list = typeActions('ab')[0]?.actions ?? [];

    expect(list.map((a) => a.type)).toEqual(['keyDown', 'keyUp', 'keyDown', 'keyUp']);
    expect(list[0]).toMatchObject({ value: 'a' });
  });

  it('日本語もそのまま送る（ブラウザは IME を通さない）', () => {
    expect(typeActions('あ')[0]?.actions[0]).toMatchObject({ value: 'あ' });
  });
});
