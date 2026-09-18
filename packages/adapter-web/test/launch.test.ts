import { describe, expect, it } from 'vitest';

import { browserArgs, browserCandidates, parseDevToolsUrl } from '../src/launch.js';

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

/**
 * **Windows は、ユーザ単位で入っているほうが普通**（2026-09-14・試験導入の前に数えた）。
 *
 * Chrome の Windows 版は、管理者権限が無いと `%LOCALAPPDATA%` の下へ入る。
 * 会社支給の端末では**そちらが既定**になることが多い。
 * `Program Files` しか見ていないと、**入っているのに「見つからない」**になる。
 *
 * **ウェブ検証が丸ごと始まらない**ので、ここは踏むと重い。
 */
describe('browserCandidates — Windows のユーザ単位の場所', () => {
  /** Windows の端末のつもりで数える。**macOS から Windows の道を確かめる。** */
  const onWindows = { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' };

  it('Chrome はユーザの下も見る', () => {
    const paths = browserCandidates('chrome', onWindows);

    expect(paths.some((p) => p.includes('AppData') && p.endsWith('chrome.exe'))).toBe(true);
  });

  it('Edge もユーザの下を見る', () => {
    expect(browserCandidates('edge', onWindows).some((p) => p.includes('AppData'))).toBe(true);
  });

  /** **`Program Files` を外さない。**管理者権限で入れた人はそちらに在る。 */
  it('今までの場所も残っている', () => {
    const paths = browserCandidates('chrome', onWindows);

    expect(paths).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(paths).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  /** **中身が空の環境変数で、変な場所を探しに行かない。** */
  it('環境変数が無ければ、その候補は出さない', () => {
    const paths = browserCandidates('chrome', {});

    expect(paths.every((p) => !p.includes('undefined') && p !== '')).toBe(true);
    expect(paths.some((p) => p.includes('AppData'))).toBe(false);
  });
});

/**
 * **背面でも描き続けてもらう**（meta-taro/git-qa#31 の実測から）。
 *
 * 無人で流して録画したら、**1 ケースにつき絵が 1〜2 枚**しか来なかった
 * （0.125 秒の動画になる）。**Chromium は、背面や隠れた窓の描画を止める**ため。
 *
 * 人が見ていない実行（`--no-ui`）では、ブラウザは必ず背面にいる。
 * **ライブ映像も録画も、そこで止まる。**
 */
describe('browserArgs — 背面でも止まらない', () => {
  it('隠れた窓の描画を止めさせない', () => {
    const args = browserArgs({ port: 0, userDataDir: '/tmp/x' }).join(' ');

    expect(args).toContain('--disable-backgrounding-occluded-windows');
    expect(args).toContain('--disable-renderer-backgrounding');
    expect(args).toContain('--disable-background-timer-throttling');
  });
});

/**
 * **user-data-dir の中の、どのプロファイルか**（外部レビュー meta-taro/git-qa#35）。
 *
 * > 普段使いの Chrome は、1 つの user-data-dir の中に複数のプロファイルを持ちます。
 * > この機械の実測で **19 プロファイル**ありました。
 *
 * `user-data-dir` だけでは **`Default` が使われる** ので、
 * **検証したいサイトにログイン済みのプロファイルを選べなかった。**
 */
describe('browserArgs（どのプロファイルか）', () => {
  it('渡されたら --profile-directory を足す', () => {
    const args = browserArgs({ port: 0, userDataDir: '/tmp/x', profileDirectory: 'Profile 26' });

    expect(args).toContain('--profile-directory=Profile 26');
  });

  it('渡されなければ足さない（既定のままにする）', () => {
    const args = browserArgs({ port: 0, userDataDir: '/tmp/x' });

    expect(args.some((arg) => arg.startsWith('--profile-directory'))).toBe(false);
  });
});
