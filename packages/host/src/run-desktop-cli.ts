import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { createDesktopAdapter, readDesktopScreenText } from '@git-qa/adapter-desktop';
import { parseTestSpecTsv, verdictKeyHint, writeRunJson } from '@git-qa/core';

import { findInput, findOcr } from './ocr-path.js';
import { startRunSession } from './run-session.js';
import { fromInvocationDir } from './paths.js';
import { tauriDevArgs } from './app.js';

/**
 * 手元のデスクトップアプリで検証シートを 1 本走らせる（Issue 016 / C55）。
 *
 *   pnpm run:sheet:desktop <検証シート.tsv>
 *
 * 見る相手はシートの見出し `# 対象:` が宣言したアプリ名。**ここで別のアプリを開かない**（C40）。
 *
 * **ここは配線なので検査していない。**判断のある所（窓の選び方・触れ方の段・手順の解釈）は
 * `@git-qa/adapter-desktop` と `@git-qa/core` にあり、そちらは検査してある。
 */

const sheetPath = process.argv[2] ?? process.env['GIT_QA_SHEET'];
if (sheetPath === undefined) {
  console.error('使い方: pnpm run:sheet:desktop <検証シート.tsv> [アプリ名]');
  process.exit(1);
}

/** `20260902-150000`。人が ls で並べ替えられる形にする。 */
const runIdFrom = (at: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${String(at.getFullYear())}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `${date}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
};

const resolvedSheet = fromInvocationDir(sheetPath);

let text: string;
try {
  text = await readFile(resolvedSheet, 'utf8');
} catch {
  console.error(`[git-qa] 検証シートを開けない: ${resolvedSheet}`);
  process.exit(1);
}
const sheet = parseTestSpecTsv(text);

const app = process.argv[3] ?? sheet.meta['対象'];
if (app === undefined || app === '') {
  console.error(
    '[git-qa] 見るアプリが分からない。シートの見出しに「# 対象: アプリ名」を書くか、' +
      '2 つ目の引数で渡す（名前は窓の持ち主のもの）',
  );
  process.exit(1);
}

/** 絵から文字を読む道具（段 2）。**無ければ段 1 だけで動く。** */
const ocrPath = await findOcr();
const inputPath = await findInput();

const session = await startRunSession({
  adapter: createDesktopAdapter({
    app,
    build: { source: app, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
    ...(ocrPath === undefined ? {} : { ocrPath }),
    ...(inputPath === undefined ? {} : { inputPath }),
  }),
  sheet,
  sheetRef: {
    path: sheetPath,
    sha256: createHash('sha256').update(text).digest('hex'),
    ...(sheet.meta['タイトル'] === undefined ? {} : { title: sheet.meta['タイトル'] }),
    ...(sheet.meta['文書番号'] === undefined ? {} : { documentNumber: sheet.meta['文書番号'] }),
  },
  runId: runIdFrom(new Date()),
  sheetPath: resolvedSheet,
  operator: { handle: process.env['GIT_QA_OPERATOR'] ?? 'unknown' },
  readScreenText: readDesktopScreenText,
});

console.log(`[git-qa] 見るアプリ: ${app}${ocrPath === undefined ? '（段 1 のみ）' : ''}`);
console.log(`[git-qa] ライブ映像の橋: ${session.liveUrl}`);
console.log(`[git-qa] 画面で ${verdictKeyHint()}`);

const child = spawn(
  'pnpm',
  [
    '--filter',
    '@git-qa/desktop',
    'exec',
    'tauri',
    ...tauriDevArgs(session.liveUrl, { controlUrl: session.controlUrl, liveKind: 'images' }),
  ],
  { stdio: 'inherit' },
);

/** **開けなかったのと、閉じられたのは別**（2026-09-06 に踏んだ）。 */
child.on('close', (code) => {
  session.abort(
    code === 0 || code === null
      ? '画面が閉じられた'
      : `画面を出せなかった（終了コード ${String(code)}）。前の実行が残っていないかを見る`,
  );
});

const run = await session.done;
await session.close();

const path = await writeRunJson(fromInvocationDir('runs'), run);
console.log(`[git-qa] 証跡: ${path}`);

const placed = run.cases.filter((c) => c.verifiedBy !== undefined).length;
console.log(`[git-qa] ${String(run.cases.length)} 件中 ${String(placed)} 件を人が見て置いた`);

child.kill();
