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
  close(): Promise<void>;
}

export interface StartLiveSessionOptions {
  readonly adapter: TargetAdapter;
  /** 差し替え口。既定は本物の橋。**橋が起きない場合の後始末を検査するために要る。** */
  readonly startBridge?: (options: LiveBridgeOptions) => Promise<LiveBridge>;
}

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

    const frames = liveView.frames.bind(liveView);
    const bridge = await (options.startBridge ?? startLiveBridge)({ source: frames });

    let closed = false;
    return {
      session,
      liveUrl: bridge.url,
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
