import type { CdpSocket } from './cdp.js';

/**
 * 本物の繋ぎ口。**Node に入っている WebSocket を使う**（依存を足さない・C54）。
 *
 * **ここは配線なので検査していない。**判断のある所（番号の付け外し・待ち合わせ）は
 * `cdp.ts` にあり、そちらは検査してある。
 */
export async function connectCdpSocket(url: string): Promise<CdpSocket> {
  const socket = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`ブラウザに繋げない（${url}）`)), {
      once: true,
    });
  });

  return {
    send: (data) => socket.send(data),
    onMessage: (handler) => {
      socket.addEventListener('message', (event: Event) => {
        const data = (event as Event & { data?: unknown }).data;
        handler(typeof data === 'string' ? data : String(data));
      });
    },
    onClose: (handler) => {
      // **理由を握り潰さない。**切れた理由が無いと、待っている命令の落とし方が説明できない。
      socket.addEventListener('close', (event: Event) => {
        // Node の型には CloseEvent が無い。**要る所だけ読む。**
        const closed = event as Event & { code?: number; reason?: string };
        const reason = closed.reason ?? '';
        handler(reason === '' ? `繋がりが閉じた（${String(closed.code ?? 0)}）` : reason);
      });
      socket.addEventListener('error', () => handler('ブラウザとの繋がりが落ちた'));
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        socket.addEventListener('close', () => resolve(), { once: true });
        socket.close();
      }),
  };
}
