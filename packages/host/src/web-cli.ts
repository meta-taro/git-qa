import { spawn } from 'node:child_process';

import { createWebAdapter } from '@git-qa/adapter-web';

import { runWithLiveView, tauriDevArgs } from './app.js';

/**
 * ウェブページに繋いで、画面を起こす（Issue 015 / C54）。
 *
 *   pnpm live:web http://localhost:3000/
 *
 * **ここは配線なので検査していない。**判断のある所（繋ぐ順・後始末・引数の組み立て・
 * 絵の運び方）は `app.ts` / `live-session.ts` / `adapter-web` にあり、そちらは検査してある。
 */

const url = process.argv[2];
if (url === undefined || url === '') {
  // **黙って既定の場所へ行かない。**どこを検証しているか分からない証跡になる。
  console.error('見る場所が要る: pnpm live:web <URL>（例: http://localhost:3000/）');
  process.exit(1);
}

await runWithLiveView({
  adapter: createWebAdapter({
    build: { source: url, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
    // 同じ幅で見ないと、崩れの有無を比べられない。
    size: { width: 1280, height: 900 },
    ...(process.env['GIT_QA_BROWSER'] === undefined
      ? {}
      : { browserPath: process.env['GIT_QA_BROWSER'] }),
    // どのブラウザで見るか。**証跡には、実際に起きたものの版が残る。**
    ...(process.env['GIT_QA_BROWSER_KIND'] === 'edge'
      ? { browser: 'edge' as const }
      : process.env['GIT_QA_BROWSER_KIND'] === 'chromium'
        ? { browser: 'chromium' as const }
        : process.env['GIT_QA_BROWSER_KIND'] === 'chrome'
          ? { browser: 'chrome' as const }
          : {}),
  }),
  launch: (liveUrl) =>
    new Promise<void>((resolve, reject) => {
      // 映らないときに、繋がっていないのか描けていないのかを切り分ける最初の手がかり。
      console.log(`[git-qa] ライブ映像の橋: ${liveUrl}`);
      const child = spawn(
        'pnpm',
        [
          '--filter',
          '@git-qa/desktop',
          'exec',
          'tauri',
          // **画面側では映像の種類を決められない。**ブラウザの絵だと知らせる（C54）。
          ...tauriDevArgs(liveUrl, { liveKind: 'images' }),
        ],
        { stdio: 'inherit' },
      );
      child.on('close', () => resolve());
      child.on('error', reject);
    }),
});
