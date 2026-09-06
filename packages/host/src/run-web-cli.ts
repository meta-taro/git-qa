import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { createFirefoxAdapter, createWebAdapter, readWebScreenText } from '@git-qa/adapter-web';
import { parseTestSpecTsv, writeRunJson } from '@git-qa/core';

import { startRunSession } from './run-session.js';
import { fromInvocationDir } from './paths.js';
import { tauriDevArgs } from './app.js';

/**
 * ウェブページで検証シートを 1 本走らせる（Issue 015 / C54）。
 *
 *   pnpm run:sheet:web <検証シート.tsv>
 *
 * 行き先はシートの見出し `# 対象:` が宣言した URL。**ここで別の場所へ行かない**（C40）。
 *
 * **ここは配線なので検査していない。**判断のある所（手順の解釈・判断保留の条件・
 * 打鍵の受け渡し・遷移）は `@git-qa/core` と `run-session.ts` にあり、そちらは検査してある。
 */

const sheetPath = process.argv[2] ?? process.env['GIT_QA_SHEET'];
if (sheetPath === undefined) {
  console.error('使い方: pnpm run:sheet:web <検証シート.tsv>');
  process.exit(1);
}

/** `20260902-150000`。人が ls で並べ替えられる形にする。 */
const runIdFrom = (at: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${String(at.getFullYear())}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `${date}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
};

// 人が打った場所を基準に解決する（pnpm --filter は cwd をパッケージへ移す）。
const resolvedSheet = fromInvocationDir(sheetPath);

let text: string;
try {
  text = await readFile(resolvedSheet, 'utf8');
} catch {
  // 積み上がったスタックではなく、人が次に何をすればよいかが分かる形で出す。
  console.error(`[git-qa] 検証シートを開けない: ${resolvedSheet}`);
  process.exit(1);
}
const sheet = parseTestSpecTsv(text);

/**
 * 見る場所。**シートが宣言したものを使う**（C40）。
 * 引数で渡された場合だけ、そちらを優先する（同じシートを検証環境へ当てるため）。
 */
const target = process.argv[3] ?? sheet.meta['対象'];
if (target === undefined || !/^https?:\/\//.test(target)) {
  console.error(
    '[git-qa] 見る場所が分からない。シートの見出しに「# 対象: http://localhost:3000/」を書くか、' +
      '2 つ目の引数で URL を渡す',
  );
  process.exit(1);
}

/** Firefox は別の口（BiDi）で動く。**同じコードには乗らない**（Issue 018）。 */
const useFirefox = process.env['GIT_QA_BROWSER_KIND'] === 'firefox';

const session = await startRunSession({
  adapter: useFirefox
    ? createFirefoxAdapter({
        build: { source: target, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
        size: { width: 1280, height: 900 },
        ...(process.env['GIT_QA_BROWSER'] === undefined
          ? {}
          : { firefoxPath: process.env['GIT_QA_BROWSER'] }),
      })
    : createWebAdapter({
        build: { source: target, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
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
  sheet,
  sheetRef: {
    path: sheetPath,
    // 実行後にシートが変わったら、突き合わせで分かるようにする。
    sha256: createHash('sha256').update(text).digest('hex'),
    ...(sheet.meta['タイトル'] === undefined ? {} : { title: sheet.meta['タイトル'] }),
    ...(sheet.meta['文書番号'] === undefined ? {} : { documentNumber: sheet.meta['文書番号'] }),
  },
  runId: runIdFrom(new Date()),
  // 画面のメニューから開けるようにする。解決済みの絶対パスを渡す。
  sheetPath: resolvedSheet,
  operator: { handle: process.env['GIT_QA_OPERATOR'] ?? 'unknown' },
  readScreenText: readWebScreenText,
});

console.log(`[git-qa] 見る場所: ${target}`);
console.log(`[git-qa] ライブ映像の橋: ${session.liveUrl}`);
console.log('[git-qa] 画面で v=VERIFIED / f=FAIL / b=BLOCKED / s=SKIP / Space=置かずに次へ');

const child = spawn(
  'pnpm',
  [
    '--filter',
    '@git-qa/desktop',
    'exec',
    'tauri',
    // **画面側では映像の種類を決められない。**ブラウザの絵だと知らせる（C54）。
    ...tauriDevArgs(session.liveUrl, { controlUrl: session.controlUrl, liveKind: 'images' }),
  ],
  { stdio: 'inherit' },
);

/**
 * 画面が終わったら、残りを「やっていない」ではなく判断保留として残して終える。
 *
 * **開けなかったのと、閉じられたのは別。**実測（2026-09-06）: 前の実行の開発サーバが
 * 残っていて `Port 1420 is already in use` で窓が出なかったのに、証跡には
 * 「画面が閉じられた」と残った。**人は自分が閉じたと思って、原因を探しに行けない。**
 */
child.on('close', (code) => {
  session.abort(
    code === 0 || code === null
      ? '画面が閉じられた'
      : `画面を出せなかった（終了コード ${String(code)}）。前の実行が残っていないかを見る`,
  );
});

const run = await session.done;
await session.close();

// 動画は既定で Git に入れない（C29）。`runs/` は .gitignore にある。
const path = await writeRunJson(fromInvocationDir('runs'), run);
console.log(`[git-qa] 証跡: ${path}`);

const placed = run.cases.filter((c) => c.verifiedBy !== undefined).length;
console.log(`[git-qa] ${String(run.cases.length)} 件中 ${String(placed)} 件を人が見て置いた`);

child.kill();
