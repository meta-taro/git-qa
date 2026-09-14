import { readFile } from 'node:fs/promises';

import { createDesktopAdapter, readDesktopScreenText } from '@git-qa/adapter-desktop';
import { parseTestSpecTsv, sheetDigest, verdictKeyHint, saveRunProgress } from '@git-qa/core';

import { findInput, findOcr } from './ocr-path.js';
import { installSaveOnExit } from './save-on-exit.js';
import { startRunSession } from './run-session.js';
import { fromInvocationDir } from './paths.js';
import { spawnDesktop, tauriDevArgs, assertDesktopPortFree, killTree } from './app.js';

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

/**
 * **AI が触った場所を、画面へ流す道**（要望シート No.1）。
 * アダプタは実行器より先に作るので、知らせ先を後から預ける形にする。
 */
let reportPointed:
  | ((at: { x: number; y: number; width?: number; height?: number; label?: string }) => void)
  | undefined;

const session = await startRunSession({
  adapter: createDesktopAdapter({
    app,
    build: { source: app, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
    ...(ocrPath === undefined ? {} : { ocrPath }),
    ...(inputPath === undefined ? {} : { inputPath }),
    onPointed: (at) => reportPointed?.(at),
  }),
  registerPointing: (report) => {
    reportPointed = report;
  },
  sheet,
  sheetRef: {
    path: sheetPath,
    sha256: sheetDigest(text),
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

/**
 * **起こす前に、口が空いているかを見る**（外部レビュー meta-taro/git-qa#7）。
 *
 * 掴まれたまま起こすと、vite の「Port 1420 is already in use」で死ぬ。
 * **その文言からは、掴んでいるのが誰か分からない。**
 */
await assertDesktopPortFree();
const child = spawnDesktop(
  tauriDevArgs(session.liveUrl, {
    controlUrl: session.controlUrl,
    liveKind: 'images',
    targetKind: 'desktop',
  }),
);

/** **開けなかったのと、閉じられたのは別**（2026-09-06 に踏んだ）。 */
child.on('close', (code) => {
  session.abort(
    code === 0 || code === null
      ? '画面が閉じられた'
      : `画面を出せなかった（終了コード ${String(code)}）。前の実行が残っていないかを見る`,
  );
});

/**
 * **落ちても、人が置いた判定を失わない**（外部レビュー #2）。
 *
 * `abort` を通すので、残りのケースは**判断保留として残り**、証跡は完全な形で書ける。
 * **拾える落ち方だけが対象。**`SIGKILL`・電源・親ごと消える、は救えない。
 */
installSaveOnExit({
  on: (name, handler) => {
    process.on(name as NodeJS.Signals, handler);
  },
  save: async () => {
    session.abort('人が実行を止めた（Ctrl-C / 終了の合図）');
    /**
     * **開いた窓も片付ける**（外部レビュー meta-taro/git-qa#7）。
     *
     * signal は届いていた（2026-09-14 に測り直した）。届いていなかったのは
     * **後始末のほう** —— ここが `child` に触れていなかったので、
     * `tauri → vite` の木が生き残り、次の実行が 1420 で死んでいた。
     */
    killTree(child);
    const partial = await session.done;
    await session.close();
    const saved = await saveRunProgress(fromInvocationDir('runs'), partial);
    console.log(`\n[git-qa] 途中で止めた。ここまでの証跡: ${saved}`);
  },
  exit: (code) => process.exit(code),
});

const run = await session.done;
await session.close();

const path = await saveRunProgress(fromInvocationDir('runs'), run);
console.log(`[git-qa] 証跡: ${path}`);

const placed = run.cases.filter((c) => c.verifiedBy !== undefined).length;
console.log(`[git-qa] ${String(run.cases.length)} 件中 ${String(placed)} 件を人が見て置いた`);

// **木ごと止める。**`child.kill()` では下の `vite` が残る（#7）。
killTree(child);
