import { describe, expect, it } from 'vitest';

import { createBidiClient } from '../src/bidi.js';
import type { CdpSocket } from '../src/cdp.js';

/**
 * Firefox とのやりとり（WebDriver BiDi・Issue 018）。
 *
 * **Chrome の CDP とは別の約束。**Firefox は 129 で CDP を捨てているので、
 * 古い Firefox でだけ動くものを作ると、**新しい Firefox の人の所で動かない**（C56 の「はったり」）。
 *
 * 約束の形は CDP と似ている（番号を振って投げ、同じ番号の返事を待つ）が、
 * **返事の形が違う** —— `type: "success" | "error"` が付く。
 */

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

describe('createBidiClient', () => {
  it('命令に番号を振って送り、同じ番号の返事で返す', async () => {
    const socket = fakeSocket();
    const client = createBidiClient(socket);

    const pending = client.send('browsingContext.navigate', { url: 'http://localhost:3000/' });
    const sent = lastSent(socket);

    expect(sent['method']).toBe('browsingContext.navigate');
    expect(sent['params']).toEqual({ url: 'http://localhost:3000/' });

    socket.reply({ type: 'success', id: sent['id'], result: { navigation: 'N1' } });

    await expect(pending).resolves.toEqual({ navigation: 'N1' });
  });

  /** **CDP と違うのはここ。**成功か失敗かが `type` に出る。 */
  it('断られたら、Firefox が書いた理由で落ちる', async () => {
    const socket = fakeSocket();
    const client = createBidiClient(socket);

    const pending = client.send('browsingContext.navigate', { url: 'http://nope' });
    socket.reply({
      type: 'error',
      id: lastSent(socket)['id'],
      error: 'unknown error',
      message: 'Unable to load URL',
    });

    await expect(pending).rejects.toThrow(/Unable to load URL/);
  });

  it('返事が前後しても取り違えない', async () => {
    const socket = fakeSocket();
    const client = createBidiClient(socket);

    const first = client.send('A');
    const firstId = lastSent(socket)['id'];
    const second = client.send('B');
    const secondId = lastSent(socket)['id'];

    socket.reply({ type: 'success', id: secondId, result: { who: 'B' } });
    socket.reply({ type: 'success', id: firstId, result: { who: 'A' } });

    await expect(first).resolves.toEqual({ who: 'A' });
    await expect(second).resolves.toEqual({ who: 'B' });
  });

  it('通知は購読した人へ配る（番号が付かない）', () => {
    const socket = fakeSocket();
    const client = createBidiClient(socket);
    const seen: Record<string, unknown>[] = [];
    client.on('browsingContext.load', (params) => seen.push(params));

    socket.reply({ type: 'event', method: 'browsingContext.load', params: { context: 'C1' } });

    expect(seen).toEqual([{ context: 'C1' }]);
  });

  /** **繋がりが切れたら、待っている命令を落とす**（待たせたままにしない）。 */
  it('繋がりが切れたら、待っている命令を全部落とす', async () => {
    const socket = fakeSocket();
    const client = createBidiClient(socket);

    const pending = client.send('browsingContext.navigate');
    socket.drop('Firefox が閉じられた');

    await expect(pending).rejects.toThrow(/Firefox が閉じられた/);
  });

  it('読めない返事は捨てる（繋がり全体を巻き込まない）', () => {
    const socket = fakeSocket();
    createBidiClient(socket);

    expect(() => socket.reply('{{{')).not.toThrow();
  });
});
