import { spawn } from 'node:child_process';

import { createAndroidAdapter } from '@git-qa/adapter-android';

import { runWithLiveView, tauriDevArgs } from './app.js';

/**
 * 端末に繋いで、画面を起こす。
 *
 *   pnpm live
 *
 * **ここは配線なので検査していない。**判断のある所（繋ぐ順・後始末・引数の組み立て）は
 * `app.ts` / `live-session.ts` にあり、そちらは検査してある。
 */

const build = {
  source: process.env['GIT_QA_APP_SOURCE'] ?? 'example/sample-notes-app',
  label: process.env['GIT_QA_APP_LABEL'] ?? 'dev',
};

await runWithLiveView({
  adapter: createAndroidAdapter({
    build,
    // 枠の中に描く方式（C27 の方式 A / C32）。別窓ではない。
    liveView: { mode: 'h264-stream' },
    ...(process.env['GIT_QA_ANDROID_SERIAL'] === undefined
      ? {}
      : { serial: process.env['GIT_QA_ANDROID_SERIAL'] }),
  }),
  launch: (liveUrl) =>
    new Promise<void>((resolve, reject) => {
      // 起動できたかを人が確かめられるようにする。映らないときに、繋がっていないのか
      // 描けていないのかを切り分ける最初の手がかりになる。
      console.log(`[git-qa] ライブ映像の橋: ${liveUrl}`);
      const child = spawn(
        'pnpm',
        ['--filter', '@git-qa/desktop', 'exec', 'tauri', ...tauriDevArgs(liveUrl)],
        { stdio: 'inherit' },
      );
      child.on('close', () => resolve());
      child.on('error', reject);
    }),
});
