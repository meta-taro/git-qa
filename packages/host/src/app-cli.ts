import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';

import { createDesktopAdapter, readDesktopScreenText } from '@git-qa/adapter-desktop';

import {
  createFirefoxAdapter,
  createSafariAdapter,
  createWebAdapter,
  readWebScreenText,
} from '@git-qa/adapter-web';

import {
  createAndroidAdapter,
  listAndroidDevices,
  readAndroidScreenText,
} from '@git-qa/adapter-android';
import { parseTestSpecTsv, sheetDigest, saveRunProgress } from '@git-qa/core';
import type { Run } from '@git-qa/core';

import { tauriDevArgs } from './app.js';
import { findSheets, keepRunnableSheets, newestFirst, sheetSearchRoots } from './find-sheets.js';
import { fromInvocationDir, runsDir } from './paths.js';
import { findInput, findOcr } from './ocr-path.js';
import { startRunSession } from './run-session.js';
import type { RunSession } from './run-session.js';
import { startSetupServer } from './setup-server.js';
import { watchParent } from './watch-parent.js';

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

/**
 * 絵から文字を読む道具（段 2・C55）。
 *
 * **配布物には同梱されている**（`resources/git-qa-ocr`）。この実行器は同じ所から
 * 呼ばれるので、隣を見に行けば見つかる。**無ければ段 1 だけで動く。**
 */
const ocrPath = await findOcr();
const inputPath = await findInput();

/** `20260902-150000`。人が ls で並べ替えられる形にする。 */
const runIdFrom = (at: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${String(at.getFullYear())}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `${date}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
};

const workingDir = fromInvocationDir('.');

/**
 * 検証シートを探す場所。**ホームの下は漁らない**（`sheetSearchRoots` に理由がある）。
 */
const sheetRoots = sheetSearchRoots(workingDir, homedir());

/** 一覧に出す数。**少し出す。**残りは「別の場所から選ぶ…」と「最近開いた」で足りる。 */
const SHEET_LIMIT = 5;
let session: RunSession | undefined;
let finished: Promise<Run> | undefined;

const setup = await startSetupServer({
  listDevices: async () => (await listAndroidDevices()).map((d) => ({ ...d })),
  findSheets: async () =>
    newestFirst(
      await keepRunnableSheets(
        (await Promise.all(sheetRoots.map((root) => findSheets(root)))).flat(),
      ),
      SHEET_LIMIT,
    ),

  start: async ({ serial, sheetPath, operator, browser, browserPath }) => {
    const text = await readFile(sheetPath, 'utf8');
    const sheet = parseTestSpecTsv(text);

    /**
     * 見る相手は、端末か、ウェブページか。**形で見分ける。**
     *
     * 画面から来るのは「選んだ端末の serial」か「打ち込まれた URL」のどちらか。
     * ここで別の場所へ行かない —— ウェブの行き先はシートの `# 対象:`（C40）。
     */
    const web = /^https?:\/\//.test(serial);
    const url = web ? (sheet.meta['対象'] ?? serial) : undefined;
    /** `app:計算機` の形で来たら、デスクトップアプリ（Issue 016）。 */
    const app = serial.startsWith('app:') ? serial.slice(4) : undefined;

    /** Firefox と Safari はエンジンが違う。**同じコードには乗らない**（Issue 018）。 */
    const chromium =
      browser === 'firefox' || browser === 'safari' || browser === undefined ? undefined : browser;

    session = await startRunSession({
      adapter:
        app !== undefined
          ? createDesktopAdapter({
              app,
              build: { source: app, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
              // **同梱の OCR を既定で使う**（段 2・C55）。無ければ段 1 だけで動く。
              ...(ocrPath === undefined ? {} : { ocrPath }),
              // **前面に出さずに押す道具**（C57 追記）。無ければ前面へ出す道へ落ちる。
              ...(inputPath === undefined ? {} : { inputPath }),
            })
          : web && url !== undefined && browser === 'firefox'
            ? createFirefoxAdapter({
                build: { source: url, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
                size: { width: 1280, height: 900 },
              })
            : web && url !== undefined && browser === 'safari'
              ? createSafariAdapter({
                  build: { source: url, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
                })
              : web && url !== undefined
                ? createWebAdapter({
                    build: { source: url, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
                    // 同じ幅で見ないと、崩れの有無を比べられない。
                    size: { width: 1280, height: 900 },
                    // **画面で選ばれたブラウザで見る。**証跡には実際に起きたものの版が残る。
                    // 場所が指定されていれば、そちらが優先（名前の無いブラウザ）。
                    ...(browserPath === undefined ? {} : { browserPath }),
                    ...(chromium === undefined || browserPath !== undefined
                      ? {}
                      : { browser: chromium }),
                  })
                : createAndroidAdapter({
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
        sha256: sheetDigest(text),
        ...(sheet.meta['タイトル'] === undefined ? {} : { title: sheet.meta['タイトル'] }),
        ...(sheet.meta['文書番号'] === undefined ? {} : { documentNumber: sheet.meta['文書番号'] }),
      },
      runId: runIdFrom(new Date()),
      sheetPath,
      // **置いた人。**画面から受け取る。無ければ環境変数、それも無ければ unknown
      // （unknown のまま残ると「誰が保証したか」が読めないので、画面側で入力を促す）。
      operator: { handle: operator ?? process.env['GIT_QA_OPERATOR'] ?? 'unknown' },
      readScreenText:
        app !== undefined ? readDesktopScreenText : web ? readWebScreenText : readAndroidScreenText,
      // **保存は実行の一部。**配布物（--serve）には書く処理が無く、人が置いた判定が
      // どこにも残らないまま終わっていた（2026-09-04・実機で踏んだ）。
      // 動画は既定で Git に入れない（C29）。`runs/` は .gitignore にある。
      saveRun: async (run) => {
        const path = await saveRunProgress(runsDir('runs'), run);
        const placed = run.cases.filter((c) => c.verifiedBy !== undefined).length;
        console.log(`[git-qa] 証跡: ${path}`);
        console.log(
          `[git-qa] ${String(run.cases.length)} 件中 ${String(placed)} 件を人が見て置いた`,
        );
        return path;
      },
    });

    finished = session.done;
    // **画面側では映像の種類を決められない。**実行器が知らせる（C54）。
    return {
      liveUrl: session.liveUrl,
      controlUrl: session.controlUrl,
      liveKind: web || app !== undefined ? ('images' as const) : ('h264' as const),
    };
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
  // **標準入力だけでは足りない。**親が強く落とされると閉じないことがあり、
  // 実際に数日前のものを含めて 12 個残っていた（2026-09-04）。親の PID も見る。
  process.stdin.on('close', stop);
  process.stdin.on('end', stop);
  process.stdin.resume();
  watchParent({ onOrphan: stop });
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
    // 保存は `saveRun` が済ませている（置き終わった時点で書く。画面を閉じるまで待たない）。
    await finished;
    await session?.close();
  }

  await setup.close();
}
