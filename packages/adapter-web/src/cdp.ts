/**
 * ブラウザとのやりとり（Chrome DevTools Protocol）。
 *
 * **依存を足さずに作る**（C54）。Node に WebSocket が入っており、人はブラウザを
 * 既に持っている。約束そのものは単純で、「番号を振って投げ、同じ番号の返事を待つ」だけ。
 *
 * ここには**繋ぎ方を書かない。**繋ぐのは {@link CdpSocket} の役目で、こちらは
 * 番号の付け外しと待ち合わせだけを持つ。**ブラウザを起こさずに検査できるのはそのため。**
 */

/** 繋ぎ口。**本物の WebSocket も、検査用の偽物も、この形で渡す。** */
export interface CdpSocket {
  send(data: string): void;
  onMessage(handler: (data: string) => void): void;
  /** 切れた理由。**黙って切らせない**（待っている命令を落とすのに要る）。 */
  onClose(handler: (reason: string) => void): void;
  close(): Promise<void>;
}

export type CdpParams = Record<string, unknown>;

export interface CdpClient {
  /**
   * 命令を 1 つ投げて、返事を待つ。
   *
   * `sessionId` を渡すと、その画面あての命令になる（渡さなければブラウザ全体あて）。
   */
  send(method: string, params?: CdpParams, sessionId?: string): Promise<CdpParams>;
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

export function createCdpClient(socket: CdpSocket): CdpClient {
  let nextId = 1;
  const waiting = new Map<number, Waiting>();
  const listeners = new Map<string, Set<(params: CdpParams) => void>>();
  /** 切れた理由。**入っていたら、もう投げても届かない。** */
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

    const id = message['id'];
    if (typeof id === 'number') {
      const pending = waiting.get(id);
      if (pending === undefined) return;
      waiting.delete(id);

      const error = message['error'];
      if (isRecord(error)) {
        // **ブラウザが書いた理由をそのまま渡す。**言い換えると、原因が絞れなくなる。
        const detail =
          typeof error['message'] === 'string' ? error['message'] : JSON.stringify(error);
        pending.reject(new Error(`${pending.method} を断られた: ${detail}`));
        return;
      }
      pending.resolve(isRecord(message['result']) ? message['result'] : {});
      return;
    }

    const method = message['method'];
    if (typeof method !== 'string') return;
    const params = isRecord(message['params']) ? message['params'] : {};
    for (const handler of listeners.get(method) ?? []) handler(params);
  });

  socket.onClose((reason) => {
    closedReason = reason;
    // **待っている命令を落とす。**落とさないと、返事を待ったまま何も起きない
    // —— 人から見ると「押しても何も起きない」になる。
    for (const [id, pending] of waiting) {
      waiting.delete(id);
      pending.reject(new Error(`${pending.method} の途中で繋がりが切れた: ${reason}`));
    }
  });

  return {
    send(method, params, sessionId) {
      if (closedReason !== undefined) {
        return Promise.reject(new Error(`${method} を送れない: ${closedReason}`));
      }
      const id = nextId;
      nextId += 1;

      return new Promise<CdpParams>((resolve, reject) => {
        waiting.set(id, { resolve, reject, method });
        socket.send(
          JSON.stringify({
            id,
            method,
            ...(params === undefined ? {} : { params }),
            ...(sessionId === undefined ? {} : { sessionId }),
          }),
        );
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
