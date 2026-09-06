import { describe, expect, it } from 'vitest';

import { browserArgs, parseDevToolsUrl } from '../src/launch.js';

/**
 * ブラウザを起こす。**人が持っているものを使う**（C54）。
 *
 * ここに置くのは「どう起こすか」を決める所だけ。実際に起こすのは配線なので検査していない。
 */

describe('browserArgs', () => {
  it('繋ぎ口を開けて、人のプロファイルを触らない場所で起こす', () => {
    const args = browserArgs({ port: 0, userDataDir: '/tmp/git-qa-web-1' });

    expect(args).toContain('--remote-debugging-port=0');
    // **人の Chrome を乗っ取らない。**開いているタブや履歴に触れる場所で起こさない。
    expect(args).toContain('--user-data-dir=/tmp/git-qa-web-1');
  });

  it('最初の画面は空にする（人の起動ページを検証対象にしない）', () => {
    // 行き先はシートの「# 対象:」が宣言したものだけ（C40）。
    expect(browserArgs({ port: 0, userDataDir: '/tmp/x' })).toContain('about:blank');
  });

  it('画面を人に見せる（見えない描画で判断させない・C54）', () => {
    expect(browserArgs({ port: 0, userDataDir: '/tmp/x' })).not.toContain('--headless');
  });

  it('大きさを指定できる（同じ幅で見ないと、崩れの有無が比べられない）', () => {
    const args = browserArgs({
      port: 0,
      userDataDir: '/tmp/x',
      size: { width: 1280, height: 800 },
    });

    expect(args).toContain('--window-size=1280,800');
  });
});

/**
 * 起こしたブラウザは、繋ぎ先を**標準エラーに 1 行**書く。
 * **port を 0 で開けている**ので、実際の番号はここからしか分からない。
 */
describe('parseDevToolsUrl', () => {
  it('繋ぎ先の 1 行を読む', () => {
    expect(
      parseDevToolsUrl('DevTools listening on ws://127.0.0.1:52341/devtools/browser/abc'),
    ).toBe('ws://127.0.0.1:52341/devtools/browser/abc');
  });

  it('前後に別の行が混ざっていても読む', () => {
    const out = [
      '[1234:0906/...] WARNING: something',
      'DevTools listening on ws://127.0.0.1:9/devtools/browser/x',
      '[1234:0906/...] more noise',
    ].join('\n');

    expect(parseDevToolsUrl(out)).toBe('ws://127.0.0.1:9/devtools/browser/x');
  });

  it('まだ出ていなければ undefined（当て推量で繋がない）', () => {
    expect(parseDevToolsUrl('')).toBeUndefined();
    expect(parseDevToolsUrl('起動中...')).toBeUndefined();
  });
});
