import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { exePathArgs, fingerprintOf, parseExePath } from '../src/fingerprint.js';

/**
 * **相手が走行中に変わったかを測る**（外部レビュー meta-taro/git-qa#3）。
 *
 * デスクトップアプリなら、**窓の持ち主の実行ファイル**を見る。
 * 大きさと更新時刻が変われば、別のビルドになっている。
 *
 * **完全ではない。**中身だけ差し替わるホットリロードは、実行ファイルを変えない。
 * だからこれは「変わったら分かる」であって「**変わっていないことの保証**」ではない。
 *
 * ---
 *
 * **2026-09-11、ここで 1 度しくじった。**
 *
 * 最初は JXA（`osascript`）で `NSRunningApplication` を呼んでいた。
 * **`NSRunningApplication` は Foundation ではなく AppKit** なので、
 * 実物では毎回こう返っていた。
 *
 * ```
 * execution error: TypeError: undefined is not an object
 *   (evaluating '$.NSRunningApplication.runningApplicationWithProcessIdentifier')
 * ```
 *
 * 呼び側は失敗を `undefined` に畳んでいたので、**証跡には「測る口を持っていない」と
 * 出ていた。**口はあったのに。
 *
 * **文字列の形だけを見る検査では、これは捕まらない。**
 * だから下に、**本当に動かす検査**を置いてある。
 */
const run = promisify(execFile);
const onMac = process.platform === 'darwin';

describe('exePathArgs', () => {
  it('プロセス番号を聞く形になっている', () => {
    const { command, args } = exePathArgs(1398);

    expect(command).toBe('/usr/sbin/lsof');
    expect(args).toContain('1398');
  });

  /**
   * **本当に動かす。**ここが今回の教訓で、形だけ見ていたから 1 度外した。
   * 自分自身のプロセス番号を聞けば、どの機械でも答えが返る。
   */
  it.skipIf(!onMac)('実物で、自分の実行ファイルの場所が返る', async () => {
    const { command, args } = exePathArgs(process.pid);
    const { stdout } = await run(command, [...args]);

    expect(parseExePath(stdout)).toBe(process.execPath);
  });

  /** 居ないプロセスを聞いたら、**何も返らない**（それを「測れなかった」として扱う）。 */
  it('答えが空なら、場所は無い', () => {
    expect(parseExePath('')).toBeUndefined();
    expect(parseExePath('\n')).toBeUndefined();
  });

  it('n で始まる最初の行を取る', () => {
    const said = ['ftxt', 'n/A/x.app/Contents/MacOS/x', 'n/Library/Preferences/somethingelse'].join(
      '\n',
    );

    expect(parseExePath(said)).toBe('/A/x.app/Contents/MacOS/x');
  });
});

describe('fingerprintOf', () => {
  it('場所と大きさと更新時刻を 1 本にする', () => {
    const print = fingerprintOf(
      '/A/x.app/Contents/MacOS/x',
      1234,
      new Date('2026-09-11T10:00:00Z'),
    );

    expect(print).toContain('/A/x.app/Contents/MacOS/x');
    expect(print).toContain('1234');
    expect(print).toContain('2026-09-11T10:00:00.000Z');
  });

  /** **同じものは同じ文字列になる。**でないと、毎回「変わった」と言うことになる。 */
  it('同じ入力なら同じ文字列', () => {
    const at = new Date('2026-09-11T10:00:00Z');

    expect(fingerprintOf('/a', 1, at)).toBe(fingerprintOf('/a', 1, at));
  });

  it('どれか 1 つ変われば、別の文字列', () => {
    const at = new Date('2026-09-11T10:00:00Z');

    expect(fingerprintOf('/a', 1, at)).not.toBe(fingerprintOf('/a', 2, at));
    expect(fingerprintOf('/a', 1, at)).not.toBe(fingerprintOf('/b', 1, at));
  });
});
