import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  createAndroidAdapter,
  listAndroidDevices,
  readAndroidScreenText,
} from '@git-qa/adapter-android';
import { parseTestSpecTsv, writeRunJson } from '@git-qa/core';
import type { Run } from '@git-qa/core';

import { tauriDevArgs } from './app.js';
import { findSheets } from './find-sheets.js';
import { fromInvocationDir } from './paths.js';
import { startRunSession } from './run-session.js';
import type { RunSession } from './run-session.js';
import { startSetupServer } from './setup-server.js';

/**
 * アプリを入口にして起動する（Issue 011 段階 3）。
 *
 *   pnpm app
 *
 * **端末に繋ぐ前に画面を出す。**人はアプリの中で端末と検証シートを選んで始められる。
 * ターミナルで打つのは、この 1 行だけ。
 *
 * **`--serve` を付けると、画面を起こさずサーバだけを立てる。**配布物（.app）の中から
 * 呼ばれる形で、画面は Tauri 側が既に出している。URL は標準出力の 1 行目に出す。
 *
 * **ここは配線なので検査していない。**判断のある所（入口サーバ・シート探し・実行）は
 * `setup-server.ts` / `find-sheets.ts` / `run-session.ts` にあり、そちらは検査してある。
 */

/** 画面を起こさない（配布物の中から呼ばれるとき）。 */
const serveOnly = process.argv.includes('--serve');

/** `20260902-150000`。人が ls で並べ替えられる形にする。 */
const runIdFrom = (at: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${String(at.getFullYear())}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `${date}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
};

const workingDir = fromInvocationDir('.');
let session: RunSession | undefined;
let finished: Promise<Run> | undefined;

const setup = await startSetupServer({
  listDevices: async () => (await listAndroidDevices()).map((d) => ({ ...d })),
  findSheets: () => findSheets(workingDir),

  start: async ({ serial, sheetPath, operator }) => {
    const text = await readFile(sheetPath, 'utf8');
    const sheet = parseTestSpecTsv(text);

    session = await startRunSession({
      adapter: createAndroidAdapter({
        build: {
          source: process.env['GIT_QA_APP_SOURCE'] ?? 'example/sample-notes-app',
          label: process.env['GIT_QA_APP_LABEL'] ?? 'dev',
        },
        liveView: { mode: 'h264-stream' },
        serial,
      }),
      sheet,
      sheetRef: {
        path: sheetPath,
        sha256: createHash('sha256').update(text).digest('hex'),
        ...(sheet.meta['タイトル'] === undefined ? {} : { title: sheet.meta['タイトル'] }),
        ...(sheet.meta['文書番号'] === undefined ? {} : { documentNumber: sheet.meta['文書番号'] }),
      },
      runId: runIdFrom(new Date()),
      sheetPath,
      // **置いた人。**画面から受け取る。無ければ環境変数、それも無ければ unknown
      // （unknown のまま残ると「誰が保証したか」が読めないので、画面側で入力を促す）。
      operator: { handle: operator ?? process.env['GIT_QA_OPERATOR'] ?? 'unknown' },
      readScreenText: readAndroidScreenText,
    });

    finished = session.done;
    return { liveUrl: session.liveUrl, controlUrl: session.controlUrl };
  },
});

console.log(`[git-qa] 画面から始める: ${setup.url}`);

if (serveOnly) {
  // 画面は既に出ている。**ここは待つだけ。**親（アプリ）が終わればここも終わる。
  const stop = (): void => {
    void session?.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // 親が消えたら道連れにする。残ると端末を掴んだままになる。
  process.stdin.on('close', stop);
  process.stdin.resume();
} else {
  const child = spawn(
    'pnpm',
    [
      '--filter',
      '@git-qa/desktop',
      'exec',
      'tauri',
      ...tauriDevArgs(undefined, { setupUrl: setup.url }),
    ],
    { stdio: 'inherit' },
  );

  // 画面が閉じられたら、残りを「やっていない」ではなく判断保留として残して終える。
  child.on('close', () => session?.abort('画面が閉じられた'));

  await new Promise<void>((resolve) => child.on('close', () => resolve()));

  if (finished !== undefined) {
    const run = await finished;
    await session?.close();
    // 動画は既定で Git に入れない（C29）。`runs/` は .gitignore にある。
    const path = await writeRunJson(fromInvocationDir('runs'), run);
    console.log(`[git-qa] 証跡: ${path}`);
    const placed = run.cases.filter((c) => c.verifiedBy !== undefined).length;
    console.log(`[git-qa] ${String(run.cases.length)} 件中 ${String(placed)} 件を人が見て置いた`);
  }

  await setup.close();
}
