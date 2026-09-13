import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { busyPortMessage, whoHoldsArgs, isPortBusy, parseHolders } from '../src/port.js';

/**
 * **掴んだまま残った窓のせいで、次の実行が死ぬ**（外部レビュー meta-taro/git-qa#7）。
 *
 * > 実行を止めても vite が残り、次の実行が「Port 1420 is already in use」で死ぬ
 *
 * 実物で再現した（2026-09-13）。親を止めても、その下の `vite` は生き残る。
 *
 * ```
 * error when starting dev server:
 * Error: Port 1420 is already in use
 * ```
 *
 * **掴んでいるのが誰かは、この文言からは分からない。**
 * 別のセッションのものかもしれないし、自分が置き去りにしたものかもしれない。
 * **どちらかで、やることが変わる。**
 */

let holder: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) =>
    holder === undefined ? resolve() : holder.close(() => resolve()),
  );
  holder = undefined;
});

describe('isPortBusy', () => {
  it('空いていれば、空いていると言う', async () => {
    expect(await isPortBusy(59321)).toBe(false);
  });

  it('掴まれていれば、掴まれていると言う', async () => {
    holder = createServer();
    await new Promise<void>((resolve) => holder?.listen(59322, '127.0.0.1', resolve));

    expect(await isPortBusy(59322)).toBe(true);
  });

  /**
   * **IPv6 で待ち受けている相手も見つける**（2026-09-13・実物で踏んだ）。
   *
   * `vite` は `[::1]:1420` で待ち受ける。`127.0.0.1` だけを見ていたので、
   * **掴まれているのに「空いている」と答えていた。**
   *
   * ```
   * 掴まれている? false
   * node 72394 … TCP [::1]:1420 (LISTEN)
   * ```
   *
   * **走らせなければ出ない。**検査が `127.0.0.1` で立てていたので、通ってしまっていた。
   */
  it('IPv6 で待ち受けている相手も見つける', async () => {
    holder = createServer();
    await new Promise<void>((resolve) => holder?.listen(59323, '::1', resolve));

    expect(await isPortBusy(59323)).toBe(true);
  });
});

describe('whoHoldsArgs', () => {
  /** **OS で聞き方が違う。**聞けない OS では、聞かない。 */
  it('macOS と Linux は lsof', () => {
    expect(whoHoldsArgs(1420, 'darwin')).toEqual({ command: 'lsof', args: ['-ti', ':1420'] });
    expect(whoHoldsArgs(1420, 'linux')?.command).toBe('lsof');
  });

  it('Windows は netstat', () => {
    expect(whoHoldsArgs(1420, 'win32')?.command).toBe('netstat');
  });
});

describe('parseHolders', () => {
  it('lsof の答えからプロセス番号を取る', () => {
    expect(parseHolders('72394\n72517\n', 'darwin')).toEqual([72394, 72517]);
  });

  /** netstat は表で返る。**LISTENING の行の、いちばん右の数**がプロセス番号。 */
  it('netstat の答えからプロセス番号を取る', () => {
    const said = [
      '  TCP    127.0.0.1:1420    0.0.0.0:0    LISTENING    12345',
      '  TCP    127.0.0.1:1420    127.0.0.1:5  ESTABLISHED  12345',
    ].join('\n');

    expect(parseHolders(said, 'win32')).toEqual([12345]);
  });

  /** **同じものを 2 度言わない。** */
  it('同じ番号は 1 度だけ', () => {
    expect(parseHolders('99\n99\n', 'darwin')).toEqual([99]);
  });

  it('読めないものは空', () => {
    expect(parseHolders('なんだこれ', 'darwin')).toEqual([]);
  });
});

describe('busyPortMessage', () => {
  /** **誰が掴んでいるかと、どうすれば空くかを、両方出す。** */
  it('掴んでいるものと、空け方を出す', () => {
    const said = busyPortMessage(1420, [72394], 'darwin');

    expect(said).toContain('1420');
    expect(said).toContain('72394');
    expect(said).toContain('kill');
  });

  it('Windows は Windows の空け方を出す', () => {
    expect(busyPortMessage(1420, [12345], 'win32')).toContain('taskkill');
  });

  /** 誰が掴んでいるか分からなくても、**掴まれていることは言う。** */
  it('相手が分からなくても、掴まれていると言う', () => {
    expect(busyPortMessage(1420, [], 'darwin')).toContain('1420');
  });
});
