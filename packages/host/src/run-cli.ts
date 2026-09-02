import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { createAndroidAdapter, readAndroidScreenText } from '@git-qa/adapter-android';
import { parseTestSpecTsv, writeRunJson } from '@git-qa/core';

import { startRunSession } from './run-session.js';
import { fromInvocationDir } from './paths.js';
import { tauriDevArgs } from './app.js';

/**
 * 検証シートを 1 本走らせる。**一本道**（Issue 004）。
 *
 *   pnpm run:sheet <検証シート.tsv>
 *
 * **ここは配線なので検査していない。**判断のある所（手順の解釈・判断保留の条件・
 * 打鍵の受け渡し・遷移）は `@git-qa/core` と `run-session.ts` にあり、そちらは検査してある。
 */

const sheetPath = process.argv[2] ?? process.env['GIT_QA_SHEET'];
if (sheetPath === undefined) {
  console.error('使い方: pnpm run:sheet <検証シート.tsv>');
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

const session = await startRunSession({
  adapter: createAndroidAdapter({
    build: {
      source: process.env['GIT_QA_APP_SOURCE'] ?? 'example/sample-notes-app',
      label: process.env['GIT_QA_APP_LABEL'] ?? 'dev',
    },
    // 枠の中に描く方式（C27 の方式 A / C32）。別窓ではない。
    liveView: { mode: 'h264-stream' },
    ...(process.env['GIT_QA_ANDROID_SERIAL'] === undefined
      ? {}
      : { serial: process.env['GIT_QA_ANDROID_SERIAL'] }),
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
  operator: { handle: process.env['GIT_QA_OPERATOR'] ?? 'unknown' },
  readScreenText: readAndroidScreenText,
});

console.log(`[git-qa] ライブ映像の橋: ${session.liveUrl}`);
console.log('[git-qa] 画面で v=VERIFIED / f=FAIL / b=BLOCKED / s=SKIP / Space=置かずに次へ');

const child = spawn(
  'pnpm',
  [
    '--filter',
    '@git-qa/desktop',
    'exec',
    'tauri',
    ...tauriDevArgs(session.liveUrl, { controlUrl: session.controlUrl }),
  ],
  { stdio: 'inherit' },
);

// 画面が閉じられたら、残りを「やっていない」ではなく判断保留として残して終える。
child.on('close', () => session.abort('画面が閉じられた'));

const run = await session.done;
await session.close();

// 動画は既定で Git に入れない（C29）。`runs/` は .gitignore にある。
const path = await writeRunJson(fromInvocationDir('runs'), run);
console.log(`[git-qa] 証跡: ${path}`);

const placed = run.cases.filter((c) => c.verifiedBy !== undefined).length;
console.log(`[git-qa] ${String(run.cases.length)} 件中 ${String(placed)} 件を人が見て置いた`);

child.kill();
