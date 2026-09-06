import type { CdpParams, CdpSocket } from './cdp.js';

/**
 * Firefox とのやりとり（WebDriver BiDi・Issue 018 / C56）。
 *
 * **Chrome の CDP とは別の約束。**Firefox は 129 で CDP を捨てているので、
 * 古い Firefox でだけ動くものを作ると、**新しい Firefox の人の所で動かない。**
 * それは「対応している」と書いた時点で、はったりになる（C56）。
 *
 * 形は CDP と似ている（番号を振って投げ、同じ番号の返事を待つ）が、
 * **返事に `type` が付く** —— `success` か `error` か `event` か。
 * 繋ぎ口（{@link CdpSocket}）は同じものを使い回す。
 */

export interface BidiClient {
  send(method: string, params?: CdpParams): Promise<CdpParams>;
  /** 通知を購読する。戻り値を呼ぶとやめられる。 */
  on(method: string, handler: (params: CdpParams) => void): () => void;
  close(): Promise<void>;
}

interface Waiting {
  readonly resolve: (result: CdpParams) => void;
  readonly reject: (error: Error) => void;
  readonly method: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function createBidiClient(socket: CdpSocket): BidiClient {
  let nextId = 1;
  const waiting = new Map<number, Waiting>();
  const listeners = new Map<string, Set<(params: CdpParams) => void>>();
  let closedReason: string | undefined;

  socket.onMessage((data) => {
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      // **読めない返事で繋がり全体を巻き込まない。**1 通捨てるだけにする。
      return;
    }
    if (!isRecord(message)) return;

    const type = message['type'];
    if (type === 'event') {
      const method = message['method'];
      if (typeof method !== 'string') return;
      const params = isRecord(message['params']) ? message['params'] : {};
      for (const handler of listeners.get(method) ?? []) handler(params);
      return;
    }

    const id = message['id'];
    if (typeof id !== 'number') return;
    const pending = waiting.get(id);
    if (pending === undefined) return;
    waiting.delete(id);

    if (type === 'error') {
      // **Firefox が書いた理由をそのまま渡す。**言い換えると、原因が絞れなくなる。
      const detail =
        typeof message['message'] === 'string'
          ? message['message']
          : typeof message['error'] === 'string'
            ? message['error']
            : JSON.stringify(message);
      pending.reject(new Error(`${pending.method} を断られた: ${detail}`));
      return;
    }
    pending.resolve(isRecord(message['result']) ? message['result'] : {});
  });

  socket.onClose((reason) => {
    closedReason = reason;
    // **待っている命令を落とす。**落とさないと、返事を待ったまま何も起きない。
    for (const [id, pending] of waiting) {
      waiting.delete(id);
      pending.reject(new Error(`${pending.method} の途中で繋がりが切れた: ${reason}`));
    }
  });

  return {
    send(method, params) {
      if (closedReason !== undefined) {
        return Promise.reject(new Error(`${method} を送れない: ${closedReason}`));
      }
      const id = nextId;
      nextId += 1;

      return new Promise<CdpParams>((resolve, reject) => {
        waiting.set(id, { resolve, reject, method });
        socket.send(JSON.stringify({ id, method, params: params ?? {} }));
      });
    },

    on(method, handler) {
      const set = listeners.get(method) ?? new Set();
      set.add(handler);
      listeners.set(method, set);
      return () => {
        set.delete(handler);
      };
    },

    close: () => socket.close(),
  };
}
