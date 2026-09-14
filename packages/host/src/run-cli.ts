import { readFile } from 'node:fs/promises';

import { createAndroidAdapter, readAndroidScreenText } from '@git-qa/adapter-android';
import { parseTestSpecTsv, sheetDigest, verdictKeyHint, saveRunProgress } from '@git-qa/core';

import { installSaveOnExit } from './save-on-exit.js';
import { startRunSession } from './run-session.js';
import { fromInvocationDir } from './paths.js';
import { spawnDesktop, tauriDevArgs, assertDesktopPortFree, killTree } from './app.js';

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
    sha256: sheetDigest(text),
    ...(sheet.meta['タイトル'] === undefined ? {} : { title: sheet.meta['タイトル'] }),
    ...(sheet.meta['文書番号'] === undefined ? {} : { documentNumber: sheet.meta['文書番号'] }),
  },
  runId: runIdFrom(new Date()),
  // 画面のメニューから開けるようにする。解決済みの絶対パスを渡す。
  sheetPath: resolvedSheet,
  operator: { handle: process.env['GIT_QA_OPERATOR'] ?? 'unknown' },
  readScreenText: readAndroidScreenText,
});

console.log(`[git-qa] ライブ映像の橋: ${session.liveUrl}`);
console.log(`[git-qa] 画面で ${verdictKeyHint()}`);

/**
 * **起こす前に、口が空いているかを見る**（外部レビュー meta-taro/git-qa#7）。
 *
 * 掴まれたまま起こすと、vite の「Port 1420 is already in use」で死ぬ。
 * **その文言からは、掴んでいるのが誰か分からない。**
 */
await assertDesktopPortFree();
const child = spawnDesktop(tauriDevArgs(session.liveUrl, { controlUrl: session.controlUrl }));

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

// 動画は既定で Git に入れない（C29）。`runs/` は .gitignore にある。
const path = await saveRunProgress(fromInvocationDir('runs'), run);
console.log(`[git-qa] 証跡: ${path}`);

const placed = run.cases.filter((c) => c.verifiedBy !== undefined).length;
console.log(`[git-qa] ${String(run.cases.length)} 件中 ${String(placed)} 件を人が見て置いた`);

// **木ごと止める。**`child.kill()` では下の `vite` が残る（#7）。
killTree(child);
