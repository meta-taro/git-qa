import type { TargetAdapter } from '@git-qa/core';
import type { LiveBridge, LiveBridgeOptions } from '@git-qa/live-bridge';

import { startLiveSession } from './live-session.js';

/**
 * 端末に繋いでから画面を起こし、画面が閉じたら端末を離す。**最後の 1 本。**
 */

export interface RunWithLiveViewOptions {
  readonly adapter: TargetAdapter;
  /** 画面を起こす。閉じられるまで待つ。 */
  readonly launch: (liveUrl: string) => Promise<void>;
  readonly startBridge?: (options: LiveBridgeOptions) => Promise<LiveBridge>;
}

export async function runWithLiveView(options: RunWithLiveViewOptions): Promise<void> {
  // **先に端末へ繋ぐ。**繋がらないまま画面を出すと、映らないのか繋いでいないのかが
  // 人に分からなくなる。
  const live = await startLiveSession({
    adapter: options.adapter,
    ...(options.startBridge === undefined ? {} : { startBridge: options.startBridge }),
  });

  try {
    await options.launch(live.liveUrl);
  } finally {
    // 人が窓を閉じたのに端末を掴んだままにしない。落ちた場合も同じ。
    await live.close();
  }
}

/** Tauri の既定の開発サーバ。`packages/desktop/vite.config.ts` と揃えている。 */
const DEFAULT_DEV_URL = 'http://localhost:1420';

/**
 * `tauri dev` へ渡す引数。
 *
 * **Tauri は devUrl を開く。**起動時の値を webview へ渡す口はここしか無いので、
 * 映像の URL をクエリに載せる。生で埋めるとクエリが壊れるので `URL` に組ませる。
 */
export function tauriDevArgs(liveUrl: string, devUrl: string = DEFAULT_DEV_URL): string[] {
  const target = new URL(devUrl);
  target.searchParams.set('live', liveUrl);

  return ['dev', '--config', JSON.stringify({ build: { devUrl: target.toString() } })];
}
