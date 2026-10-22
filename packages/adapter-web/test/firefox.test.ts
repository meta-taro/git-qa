import { describe, expect, it } from 'vitest';

import {
  firefoxArgs,
  firefoxLaunch,
  firefoxPidPattern,
  parseBidiUrl,
  pointerActions,
  typeActions,
} from '../src/firefox.js';

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
 * **macOS では、Firefox を LaunchServices（`open`）から起こす**（2026-10-22・実機の Firefox 155 で踏んだ）。
 *
 * git-qa から直に起こすと、macOS はその Firefox を git-qa の側として扱い、
 * Firefox 自身の置き場（`~/Library/Application Support/Firefox`）を読ませない。
 * Firefox は「プロファイルが見つかりません」の小窓で止まり、BiDi の口を開かない。
 * `open -n -a` で起こすと、Firefox は Firefox として自分の置き場を読める。
 */
describe('firefoxLaunch', () => {
  const args = ['--remote-debugging-port', '0', '--profile', '/tmp/git-qa-ff-1'];

  it('macOS の .app は open で起こし、標準エラーはファイルで受ける', () => {
    const launch = firefoxLaunch({
      binary: '/Applications/Firefox.app/Contents/MacOS/firefox',
      args,
      platform: 'darwin',
      stderrPath: '/tmp/git-qa-ff-1/stderr.log',
    });

    expect(launch.viaLaunchServices).toBe(true);
    expect(launch.command).toBe('open');
    expect(launch.args).toEqual([
      '-n',
      '-a',
      '/Applications/Firefox.app',
      '--stderr',
      '/tmp/git-qa-ff-1/stderr.log',
      '--args',
      ...args,
    ]);
  });

  it('macOS でも .app の外の実行ファイルは、そのまま起こす', () => {
    const launch = firefoxLaunch({
      binary: '/opt/firefox/firefox',
      args,
      platform: 'darwin',
      stderrPath: '/tmp/x.log',
    });

    expect(launch).toEqual({ command: '/opt/firefox/firefox', args, viaLaunchServices: false });
  });

  it('Windows と Linux は、そのまま起こす', () => {
    const exe = 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
    expect(firefoxLaunch({ binary: exe, args, platform: 'win32', stderrPath: 'x' })).toEqual({
      command: exe,
      args,
      viaLaunchServices: false,
    });
  });
});

/**
 * **LaunchServices から起こした Firefox は、git-qa の子ではない。**
 * 止められたときに道連れにならないので、番号を探して覚え、こちらで落とす。
 * 探す手がかりは、この実行だけの作業場所。**人が開いている Firefox を掴まない。**
 */
describe('firefoxPidPattern', () => {
  const dir = '/var/folders/8_/x/T/git-qa-ff-AbC.1';

  it('この実行の作業場所で起きた Firefox 本体だけに当たる', () => {
    const pattern = new RegExp(firefoxPidPattern(dir));

    expect(
      pattern.test(
        `/Applications/Firefox.app/Contents/MacOS/firefox --remote-debugging-port 0 --profile ${dir} --no-remote`,
      ),
    ).toBe(true);
    // 人が普段使っている Firefox。
    expect(pattern.test('/Applications/Firefox.app/Contents/MacOS/firefox')).toBe(false);
    // 別の実行の作業場所（名前の頭が同じでも）。
    expect(pattern.test(`/Applications/Firefox.app/Contents/MacOS/firefox --profile ${dir}2`)).toBe(
      false,
    );
    // 中の部品（plugin-container）は本体が止めるので、掴まない。
    expect(
      pattern.test(
        `/Applications/Firefox.app/Contents/MacOS/plugin-container.app/Contents/MacOS/plugin-container --profile ${dir}`,
      ),
    ).toBe(false);
  });

  it('作業場所の名前の . を、何にでも当たる印として読まない', () => {
    const pattern = new RegExp(firefoxPidPattern(dir));
    expect(pattern.test(`MacOS/firefox --profile ${dir.replace('.1', 'x1')}`)).toBe(false);
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
