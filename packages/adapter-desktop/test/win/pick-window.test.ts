import { describe, expect, it } from 'vitest';

import { pickWindow, whyUnusable } from '../../src/win/tool.js';
import type { WinWindow } from '../../src/win/tool.js';

/**
 * **どの窓を相手にするかを決める**（2026-09-12・Windows 機で実測）。
 *
 * それまでは「見つかった順の 1 つ目」を使っていた。**実機で 2 種類の外し方をした。**
 *
 * 1. `sshboard` を探すと、**窓の題にパスが入っている explorer** が先に出る
 *    （`...\sshboard\sshboard\config - エクスプローラー`）
 * 2. 当の `sshboard` 自身も、**16x16 の隠れ窓**を持っていて、それが先に出る
 *
 * どちらも「見つからない」ではなく「**別のものを相手にして、静かに間違える**」。
 * 撮っても 16x16 の絵が残るだけで、人は検証したつもりになる。**そこがいちばん悪い。**
 */

/** 実機で出た並びをそのまま使う（`git-qa-win windows sshboard` の出力）。 */
const seen = (over: Partial<WinWindow>): WinWindow => ({
  hwnd: 1,
  pid: 100,
  exe: 'C:\\Users\\誰か\\AppData\\Local\\sshboard\\sshboard.exe',
  title: 'sshboard',
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  ...over,
});

describe('pickWindow', () => {
  it('窓が無ければ、無いと言う', () => {
    expect(pickWindow([], 'sshboard')).toBeUndefined();
  });

  /**
   * **実行ファイルの名前で当たったものを、題だけで当たったものより優先する。**
   * 題は、相手が何を開いているかで変わる —— explorer がたまたま同じ名前の
   * フォルダを開いていただけで、検証の相手が入れ替わってはいけない。
   */
  it('題だけの一致より、実行ファイル名の一致を採る', () => {
    const explorer = seen({
      hwnd: 4064258,
      pid: 18696,
      exe: 'C:\\Windows\\explorer.exe',
      title: 'C:\\Users\\誰か\\AppData\\Roaming\\sshboard\\sshboard\\config - エクスプローラー',
      width: 1200,
      height: 800,
    });
    const honmono = seen({ hwnd: 722418, width: 900, height: 700 });

    expect(pickWindow([explorer, honmono], 'sshboard')?.hwnd).toBe(722418);
  });

  /**
   * **同じアプリが複数の窓を持っていたら、いちばん大きいものを採る。**
   * Tauri も Electron も、目に見えない道具窓（16x16 など）を持っている。
   * **人が見ている窓は、まず大きい方。**
   */
  it('同じ実行ファイルなら、大きい窓を採る', () => {
    const kakure = seen({ hwnd: 1114824, width: 16, height: 16 });
    const honmono = seen({ hwnd: 722418, width: 1035, height: 948 });

    expect(pickWindow([kakure, honmono], 'sshboard')?.hwnd).toBe(722418);
  });

  /** 実行ファイル名で当たるものが 1 つも無ければ、**題で当たったものの中から採る。** */
  it('実行ファイル名で当たらなければ、題で当たったものを採る', () => {
    const title = seen({
      hwnd: 999,
      exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      title: 'git-qa — AI が操作し、人が判定を置く - Google Chrome',
      width: 1415,
      height: 929,
    });

    expect(pickWindow([title], 'git-qa')?.hwnd).toBe(999);
  });

  /** **大きさが同じなら、先に出た方。**同じ入力で、選ぶ窓が毎回変わらないこと。 */
  it('大きさが並んだら、先に出た方を採る', () => {
    const first = seen({ hwnd: 11 });
    const second = seen({ hwnd: 22 });

    expect(pickWindow([first, second], 'sshboard')?.hwnd).toBe(11);
  });

  /**
   * **フォルダ名が当たっただけのものを、実行ファイル名が当たったことにしない。**
   * Windows のパスは `\` 区切り。ここを `/` だけで切ると、パス全体が名前として残り、
   * **途中のフォルダ名で当たってしまう。**
   */
  it('パスの途中のフォルダ名は、実行ファイル名として数えない', () => {
    const folderOnly = seen({
      hwnd: 44,
      exe: 'C:\\tools\\sshboard\\viewer.exe',
      title: 'viewer',
      width: 1600,
      height: 1200,
    });
    const honmono = seen({ hwnd: 55, width: 400, height: 300 });

    expect(pickWindow([folderOnly, honmono], 'sshboard')?.hwnd).toBe(55);
  });

  /** 大文字小文字は見ない（道具側と同じ。人が `DBBoard` と打つか `dbboard` と打つかは決められない）。 */
  it('大文字小文字は見ない', () => {
    const one = seen({ hwnd: 33, exe: 'C:\\app\\DBBoard.exe', title: 'DBBoard' });

    expect(pickWindow([one], 'dbboard')?.hwnd).toBe(33);
  });
});

/**
 * **選べたことと、検証に使えることは別**（2026-09-12・Windows 機で実測）。
 *
 * `sshboard` の本体を最小化したまま探すと、残るのは **16x16 の道具窓**だけになる。
 * Tauri も Electron も、目に見えない窓を持っている。そのまま進むと
 * **16x16 の絵が証跡に残り、人は検証したつもりになる。**
 *
 * **見つからないのではない。**「見つかったが、人が見ている窓ではない」と言う。
 */
describe('whyUnusable', () => {
  const sized = (width: number, height: number): WinWindow => seen({ width, height });

  it('人が見ている大きさの窓は、そのまま使える', () => {
    expect(whyUnusable(sized(1035, 948))).toBeUndefined();
  });

  /** 実測で残った 16x16（Tauri の道具窓）。**これを相手にしてはいけない。** */
  it('16x16 の道具窓は使えない', () => {
    expect(whyUnusable(sized(16, 16))).toBeDefined();
  });

  /** **理由に、人が次にやることを書く。**「使えない」だけでは、人は何も直せない。 */
  it('使えない理由に、最小化を疑うことが書いてある', () => {
    expect(whyUnusable(sized(16, 16))).toContain('最小化');
  });

  /** 縦か横のどちらかが足りないだけでも、人が見ている窓ではない。 */
  it('横だけ足りない窓も使えない', () => {
    expect(whyUnusable(sized(40, 900))).toBeDefined();
  });
});
