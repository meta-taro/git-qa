import { AdapterError } from '@git-qa/core';
import type { TargetAdapter, TargetSession } from '@git-qa/core';
import { startLiveBridge } from '@git-qa/live-bridge';
import type { LiveBridge, LiveBridgeOptions } from '@git-qa/live-bridge';

/**
 * 端末に繋いで、映像を画面へ渡せる状態にする。
 *
 * **部品は揃っていても、繋ぐ 1 本が無いと何も映らない。**ここがその 1 本。
 */

export interface LiveSession {
  /** 繋いだセッション。**作り直さない。**実行器はこれで操作する。 */
  readonly session: TargetSession;
  /** 画面（webview）が読む URL。`?live=` に渡す。 */
  readonly liveUrl: string;
  /** 状態を流し、打鍵を受ける口。実行器（`run-session.ts`）が使う。 */
  readonly bridge: LiveBridge;
  close(): Promise<void>;
}

export interface StartLiveSessionOptions {
  readonly adapter: TargetAdapter;
  /** 差し替え口。既定は本物の橋。**橋が起きない場合の後始末を検査するために要る。** */
  readonly startBridge?: (options: LiveBridgeOptions) => Promise<LiveBridge>;
  /**
   * 映像が止まった理由を受け取る。**戻ったら `undefined` が来る**（出したままにしない）。
   *
   * **橋は生のバイト列を流すので、途中で理由を差し込めない。**受け取った側が
   * 別の道（制御チャネル）で人へ伝えられるように、ここで拾う。
   */
  readonly onLiveError?: (message: string | undefined) => void;
  /** 繋ぎ直しの間隔と上限。**待たない検査のために差し替えられるようにしてある。** */
  readonly reconnect?: {
    readonly intervalMs?: number;
    readonly limitMs?: number;
    readonly sleep?: (ms: number) => Promise<void>;
  };
}

/** 繋ぎ直しに来る間隔。**人がケーブルを挿し直すのに要る時間**より短くする。 */
const RECONNECT_INTERVAL_MS = 2_000;

/**
 * 繋ぎ直しを諦めるまで。
 *
 * **無限に繰り返さない。**「繋ぎ直しを繰り返すと、黙ったまま回り続ける」は
 * この道具が既に 1 度踏んだ穴（`adapter-android` のコメント）。
 * 5 分あれば、抜けたことに気づいて挿し直すには足りる。
 */
const RECONNECT_LIMIT_MS = 5 * 60_000;

export async function startLiveSession(options: StartLiveSessionOptions): Promise<LiveSession> {
  const session = await options.adapter.connect();
  // 開いたかどうかを覚える。開いていないものを閉じに行かないため。
  let opened = false;

  try {
    const { liveView } = session;
    if (liveView.frames === undefined) {
      // 別窓で出す方式のアダプタを渡された。空の枠を出すと、
      // **映らないのか繋いでいないのかが人に分からなくなる。**
      throw new AdapterError(
        options.adapter.kind,
        `このアダプタには映像を読む口が無い（transport は ${liveView.transport.kind}）`,
      );
    }
    // 開く前に口の有無を見る。開いてから気づくと、端末を掴んだまま戻ることになる。
    await liveView.open();
    opened = true;

    const original = liveView.frames.bind(liveView);
    const intervalMs = options.reconnect?.intervalMs ?? RECONNECT_INTERVAL_MS;
    const limitMs = options.reconnect?.limitMs ?? RECONNECT_LIMIT_MS;
    const sleep =
      options.reconnect?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

    let closed = false;

    /**
     * 映像が止まったら理由を控え、**繋ぎ直しに行く**（Issue 014）。
     *
     * 検証中にケーブルが抜けることがある。控えるだけだと橋の中身が尽き、
     * **挿し直しても誰も繋ぎに来ない。**画面は最後の 1 枚で固まったままになる。
     *
     * 戻ったら控えた理由を消す。**出したままだと、直っているのに直っていないように見える。**
     */
    const frames = (): AsyncIterable<Uint8Array> => ({
      async *[Symbol.asyncIterator]() {
        let waitedMs = 0;
        for (;;) {
          try {
            for await (const chunk of original()) {
              if (waitedMs > 0) {
                // 戻った。**控えた理由を消してから流す。**
                options.onLiveError?.(undefined);
                waitedMs = 0;
              }
              yield chunk;
            }
            // 尽きた。落ちたのではないので繋ぎ直さない（閉じられた・読み手が去った）。
            return;
          } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            // 閉じたなら繋ぎ直さない。**端末を掴んだままにしない。**
            if (closed) throw error;
            if (waitedMs >= limitMs) {
              // **黙って回り続けない。**何秒待ったのかまで言わないと、待てば戻るのか分からない。
              options.onLiveError?.(
                `${reason}（${String(Math.round(limitMs / 1000))} 秒待っても戻らなかった）`,
              );
              throw error;
            }
            options.onLiveError?.(`${reason} — 繋ぎ直しています`);
            await sleep(intervalMs);
            waitedMs += intervalMs;
          }
        }
      },
    });
    const bridge = await (options.startBridge ?? startLiveBridge)({ source: frames });
    return {
      session,
      liveUrl: bridge.url,
      bridge,
      async close() {
        if (closed) return;
        closed = true;
        // 読み手を先に切る。逆にすると、映像の出どころが消えた口へ繋ぎに行く。
        await bridge.close();
        await liveView.close();
        await session.close();
      },
    };
  } catch (error) {
    // 掴んだまま投げない。端末が握られたままになり、映像を吸い出すプロセスも残る。
    if (opened) await session.liveView.close();
    await session.close();
    throw error;
  }
}
