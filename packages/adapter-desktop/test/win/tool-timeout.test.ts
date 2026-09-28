import { describe, expect, it } from 'vitest';

import { runWinTool, winToolTimeoutMs } from '../../src/win/adapter.js';

/**
 * **道具が返らないとき、黙って待ち続けない**（meta-taro/git-qa#42・2026-09-27 の報告）。
 *
 * > 前回の実行を途中で止めると、git-qa-win.exe が残ります。残っていると、次の実行が
 * > **何も出さずに止まり続けます。**
 *
 * 上限を超えたら道具を止め、**何秒で返らなかったか**と**次に見るもの**を言う。
 * 起こすのは既にある `/bin/sleep`（新しい実行ファイルを作ると、macOS の検査で待たされる）。
 */
describe.skipIf(process.platform === 'win32')('runWinTool — 時間の上限', () => {
  it('上限を超えたら止めて、理由を言う', async () => {
    const started = Date.now();

    await expect(runWinTool('/bin/sleep', ['5'], 200)).rejects.toThrow(
      /0\.2 秒たっても返らなかったので止めた.*git-qa-win/,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('上限より早く返れば、そのまま返す', async () => {
    await expect(runWinTool('/bin/echo', ['ok'], 2000)).resolves.toBe('ok\n');
  });
});

describe('winToolTimeoutMs — 上限の決め方', () => {
  it('ふつうは 30 秒', () => {
    expect(winToolTimeoutMs(['press', '1', '2', '3'])).toBe(30_000);
  });

  /** 1 文字ずつ打つので、長い文字は長くかかる。**長い入力を上限で切らない。** */
  it('焦点へ打つときは、文字数の分だけ延ばす', () => {
    expect(winToolTimeoutMs(['keys', '1', 'a'.repeat(1000)])).toBe(30_000 + 1000 * 50);
  });
});
