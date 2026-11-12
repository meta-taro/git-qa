import { describe, expect, it, vi } from 'vitest';

import { sendToScreens } from '../src/agent-screen.js';

/**
 * MCP の `screen`：git-qa **自身の画面**の専用カーソルを動かす口（C120）。
 *
 * 端末（検証の相手）を触る道具とは別物。人のマウスは使わない。
 * **判定は置けない**（画面側が断る・C1 / C17）。ここは届け先を探して置くだけ。
 */

const screen = (pid: number, release = 'v0.2.1') => ({
  url: `http://127.0.0.1:${String(40000 + pid)}/setup/abc`,
  pid,
  release,
  startedAt: '2026-11-12T03:00:00.000Z',
});

const deps = (
  screens: ReturnType<typeof screen>[],
  post: (url: string, body: unknown) => Promise<{ status: number; text: string }>,
) => ({ findScreens: () => Promise.resolve(screens), post });

describe('sendToScreens', () => {
  it('開いている画面が無ければ、開いてからと言う（何も送らない）', async () => {
    const post = vi.fn();

    const said = await sendToScreens(deps([], post), { action: 'say', message: 'a' });

    expect(said.ok).toBe(false);
    expect(said.text).toContain('開いていない');
    expect(post).not.toHaveBeenCalled();
  });

  it('開いている画面の全部へ置き、届けた枚数を返す', async () => {
    const post = vi.fn().mockResolvedValue({ status: 202, text: '{"screens":1}' });

    const said = await sendToScreens(deps([screen(1), screen(2)], post), {
      action: 'point',
      target: '始める',
    });

    expect(said.ok).toBe(true);
    expect(said.text).toContain('2');
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith(screen(1).url, {
      action: 'point',
      target: '始める',
    });
  });

  it('断られた理由（形がおかしい・画面が繋いでいない）は、そのまま返す', async () => {
    const post = vi.fn().mockResolvedValue({ status: 400, text: 'target は空でない文字で' });

    const said = await sendToScreens(deps([screen(1)], post), { action: 'point', target: '' });

    expect(said.ok).toBe(false);
    expect(said.text).toContain('target は空でない文字で');
  });

  /**
   * **古い git-qa には、この口が無い。**v0.2.0 までの入口サーバは `/agent` を 404 で返す。
   * 「届いたのに動かない」ではなく、版を言う。
   */
  it('口の無い古い版（404）なら、版を言って入れ替えを頼む', async () => {
    const post = vi.fn().mockResolvedValue({ status: 404, text: '' });

    const said = await sendToScreens(deps([screen(1, 'v0.2.0')], post), {
      action: 'say',
      message: 'a',
    });

    expect(said.ok).toBe(false);
    expect(said.text).toContain('v0.2.0');
    expect(said.text).toContain('口が無い');
  });

  it('届かなかった名乗りは外す（残骸を次も試さない）', async () => {
    const post = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const forget = vi.fn();

    const said = await sendToScreens(
      { ...deps([screen(9)], post), forget },
      { action: 'say', message: 'a' },
    );

    expect(said.ok).toBe(false);
    expect(forget).toHaveBeenCalledWith(screen(9));
  });

  it('届かない画面（残骸）は理由を言い、届いた画面があればそれは数える', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 202, text: '{"screens":1}' });

    const said = await sendToScreens(deps([screen(1), screen(2)], post), {
      action: 'say',
      message: 'a',
    });

    expect(said.ok).toBe(true);
    expect(said.text).toContain('1 ');
    expect(said.text).toContain('ECONNREFUSED');
  });
});
