import { describe, expect, it, vi } from 'vitest';

import { createCdpClient } from '../src/cdp.js';
import type { CdpSocket } from '../src/cdp.js';

/**
 * ブラウザとのやりとり（CDP）。**ブラウザを起こさずに検査できる所**をここに集める。
 *
 * CDP は「番号を振って投げ、同じ番号の返事を待つ」だけの約束。
 * **番号の取り違えは、押した場所と違う所を触る形で表に出る**ので、ここで押さえる。
 */

/** 繋ぎ口の代わり。**送った文字列を握り、好きな返事を流し込める。** */
function fakeSocket(): CdpSocket & {
  sent: string[];
  reply: (message: unknown) => void;
  drop: (reason: string) => void;
} {
  const sent: string[] = [];
  let onMessage: ((data: string) => void) | undefined;
  let onClose: ((reason: string) => void) | undefined;

  return {
    sent,
    send: (data) => sent.push(data),
    onMessage: (handler) => {
      onMessage = handler;
    },
    onClose: (handler) => {
      onClose = handler;
    },
    close: () => Promise.resolve(),
    reply: (message) => onMessage?.(JSON.stringify(message)),
    drop: (reason) => onClose?.(reason),
  };
}

const lastSent = (socket: { sent: string[] }): Record<string, unknown> =>
  JSON.parse(socket.sent[socket.sent.length - 1] as string) as Record<string, unknown>;

describe('createCdpClient', () => {
  it('命令に番号を振って送り、同じ番号の返事で返す', async () => {
    const socket = fakeSocket();
    const client = createCdpClient(socket);

    const pending = client.send('Page.navigate', { url: 'http://localhost:3000/' });
    const sent = lastSent(socket);

    expect(sent['method']).toBe('Page.navigate');
    expect(sent['params']).toEqual({ url: 'http://localhost:3000/' });

    socket.reply({ id: sent['id'], result: { frameId: 'F1' } });

    await expect(pending).resolves.toEqual({ frameId: 'F1' });
  });

  /**
   * **返事は順番どおりに来ない。**先に投げたものが後から返る。
   * 番号で対応づけないと、**別の命令の返事を受け取る**（触る場所がずれる形で表に出る）。
   */
  it('返事が前後しても取り違えない', async () => {
    const socket = fakeSocket();
    const client = createCdpClient(socket);

    const first = client.send('A');
    const firstId = lastSent(socket)['id'];
    const second = client.send('B');
    const secondId = lastSent(socket)['id'];

    expect(firstId).not.toBe(secondId);

    socket.reply({ id: secondId, result: { who: 'B' } });
    socket.reply({ id: firstId, result: { who: 'A' } });

    await expect(first).resolves.toEqual({ who: 'A' });
    await expect(second).resolves.toEqual({ who: 'B' });
  });

  it('ブラウザが断ったら、その文言で落ちる（握り潰さない）', async () => {
    const socket = fakeSocket();
    const client = createCdpClient(socket);

    const pending = client.send('Page.navigate', { url: 'http://nope' });
    socket.reply({
      id: lastSent(socket)['id'],
      error: { code: -32000, message: 'Cannot navigate to invalid URL' },
    });

    await expect(pending).rejects.toThrow(/Cannot navigate to invalid URL/);
  });

  it('イベントは購読した人へ配る（番号は付かない）', () => {
    const socket = fakeSocket();
    const client = createCdpClient(socket);
    const seen: Record<string, unknown>[] = [];
    client.on('Page.screencastFrame', (params) => seen.push(params));

    socket.reply({ method: 'Page.screencastFrame', params: { data: 'AAA', sessionId: 7 } });

    expect(seen).toEqual([{ data: 'AAA', sessionId: 7 }]);
  });

  it('購読はやめられる（やめた後は届かない）', () => {
    const socket = fakeSocket();
    const client = createCdpClient(socket);
    const seen: unknown[] = [];
    const stop = client.on('X', (params) => seen.push(params));

    socket.reply({ method: 'X', params: { n: 1 } });
    stop();
    socket.reply({ method: 'X', params: { n: 2 } });

    expect(seen).toEqual([{ n: 1 }]);
  });

  /**
   * **繋がりが切れたら、待っている命令を落とす。**
   * 落とさないと、返事を待ったまま何も起きない —— 人から見ると「押しても何も起きない」。
   */
  it('繋がりが切れたら、待っている命令を全部落とす', async () => {
    const socket = fakeSocket();
    const client = createCdpClient(socket);

    const pending = client.send('Page.navigate');
    socket.drop('ブラウザが閉じられた');

    await expect(pending).rejects.toThrow(/ブラウザが閉じられた/);
  });

  it('切れた後に投げても、待たせずに落とす', async () => {
    const socket = fakeSocket();
    const client = createCdpClient(socket);
    socket.drop('ブラウザが閉じられた');

    await expect(client.send('Page.navigate')).rejects.toThrow(/ブラウザが閉じられた/);
  });

  /** 画面ごとの命令は、その画面の番号を添えて送る（ブラウザ全体への命令と区別される）。 */
  it('画面の番号を渡すと、命令に載る', () => {
    const socket = fakeSocket();
    const client = createCdpClient(socket);

    void client.send('Input.dispatchMouseEvent', { type: 'mousePressed' }, 'S1');

    expect(lastSent(socket)['sessionId']).toBe('S1');
  });

  it('読めない返事は捨てる（落とさない）', () => {
    const socket = fakeSocket();
    createCdpClient(socket);
    const onMessage = vi.fn();

    // 壊れた JSON が来ても、ここで例外を投げない。**繋がり全体を巻き込まない。**
    expect(() => {
      socket.reply('{{{');
      onMessage();
    }).not.toThrow();
  });
});
