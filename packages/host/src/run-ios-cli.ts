import { readFile } from 'node:fs/promises';

import { createIosAdapter, listIosDevices, readIosScreenText } from '@git-qa/adapter-ios';
import {
  duplicateTargetMessage,
  parseTestSpecTsv,
  saveRunProgress,
  sheetDestination,
  sheetDigest,
  sheetSubject,
  verdictKeyHint,
} from '@git-qa/core';

import { findIos, findOcr } from './ocr-path.js';
import { headlessExitCode, headlessSummary, runHeadless } from './headless.js';
import { startRunSession } from './run-session.js';
import { fromInvocationDir } from './paths.js';
import { positional } from './argv.js';
import { spawnDesktop, tauriDevArgs, assertDesktopPortFree, killTree } from './app.js';
import { installSaveOnExit } from './save-on-exit.js';

/**
 * iPhone / iPad で検証シートを 1 本走らせる（2026-09-19・人の指示）。
 *
 *   pnpm run:sheet:ios <検証シート.tsv>
 *
 * > Android を接続して検証録画できるように、iPhone,iPad の検証録画も必要です
 *
 * **押す口はまだ無い。**端末側に WebDriverAgent が要り、署名が要る＝人の作業（§14）。
 * **人が端末を触り、git-qa が見て、人が判定を置く**形になる（#30 / #35 と同じ分担）。
 *
 * **まだ実機で 1 度も流していない**（2026-09-19・C56）。
 *
 * **ここは配線なので検査していない。**判断のある所は `@git-qa/adapter-ios` にある。
 */

const sheetPath = positional(process.argv, 0) ?? process.env['GIT_QA_SHEET'];
if (sheetPath === undefined) {
  console.error('使い方: pnpm run:sheet:ios <検証シート.tsv>');
  process.exit(1);
}

const toolPath = await findIos();
if (toolPath === undefined) {
  console.error(
    '[git-qa] iPhone / iPad を映す道具が無い（macOS で pnpm build すると建ちます）。' +
      '場所を渡すなら GIT_QA_IOS',
  );
  process.exit(1);
}

const resolvedSheet = fromInvocationDir(sheetPath);
const text = await readFile(resolvedSheet, 'utf8');
const sheet = parseTestSpecTsv(text);

/** **行き先が 2 つ在るシートは走らせない**（外部レビュー meta-taro/git-qa#22）。 */
const duplicated = duplicateTargetMessage(sheet.duplicateMeta);
if (duplicated !== undefined) {
  console.error(`[git-qa] ${duplicated}`);
  process.exit(1);
}

/** **繋がっている端末を先に数える。**0 台なら、理由を出して止まる。 */
const devices = await listIosDevices(toolPath).catch((error: unknown) => {
  console.error(
    `[git-qa] 端末を数えられない: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});

if (devices.length === 0) {
  console.error(
    '[git-qa] 映せる端末が無い（USB で繋ぎ、端末側で「このコンピュータを信頼」を済ませてください）',
  );
  process.exit(1);
}

const wanted = positional(process.argv, 1) ?? process.env['GIT_QA_IOS_DEVICE'];
const ocrPath = await findOcr();

const adapter = createIosAdapter({
  toolPath,
  ...(wanted === undefined ? {} : { device: wanted }),
  ...(ocrPath === undefined ? {} : { ocrPath }),
  build: {
    source: sheetSubject(sheet.meta) ?? sheetDestination(sheet.meta) ?? 'ios',
    label: process.env['GIT_QA_APP_LABEL'] ?? 'dev',
  },
  ...(sheetDestination(sheet.meta) === undefined
    ? {}
    : { destination: sheetDestination(sheet.meta) as string }),
});

const runIdFrom = (at: Date): string =>
  at
    .toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\..+$/, '')
    .replace(/^(\d{8})(\d{6})$/, '$1-$2');

const sheetRef = {
  path: sheetPath,
  sha256: sheetDigest(text),
  ...(sheet.meta['タイトル'] === undefined ? {} : { title: sheet.meta['タイトル'] }),
  ...(sheet.meta['文書番号'] === undefined ? {} : { documentNumber: sheet.meta['文書番号'] }),
};

if (process.argv.includes('--no-ui')) {
  const run = await runHeadless({
    adapter,
    sheet,
    sheetRef,
    runId: runIdFrom(new Date()),
    runsRoot: fromInvocationDir('runs'),
    ...(process.argv.includes('--record') ? { record: true } : {}),
    operator: { handle: process.env['GIT_QA_OPERATOR'] ?? 'unknown' },
    readScreenText: readIosScreenText,
  });

  console.log(`[git-qa] 無人で走らせた（誰も見ていない）: ${headlessSummary(run.cases)}`);
  console.log(`[git-qa] 証跡: ${fromInvocationDir('runs')}/${run.runId}/run.json`);
  process.exit(headlessExitCode(run.cases));
}

const session = await startRunSession({
  adapter,
  ...(process.argv.includes('--record') ? { record: true } : {}),
  sheet,
  sheetRef,
  runId: runIdFrom(new Date()),
  sheetPath: resolvedSheet,
  operator: { handle: process.env['GIT_QA_OPERATOR'] ?? 'unknown' },
  readScreenText: readIosScreenText,
});

console.log(
  `[git-qa] 見る端末: ${devices[0]?.model ?? '不明'}${ocrPath === undefined ? '（文字は読めません）' : ''}`,
);
console.log('[git-qa] **押す口はありません。**端末はご自身で触ってください');
console.log(`[git-qa] ライブ映像の橋: ${session.liveUrl}`);
console.log(`[git-qa] 画面で ${verdictKeyHint()}`);

await assertDesktopPortFree();
const child = spawnDesktop(
  tauriDevArgs(session.liveUrl, {
    controlUrl: session.controlUrl,
    liveKind: 'images',
    // **`targetKind` は渡さない。**あれはデスクトップで指が一瞬飛ぶ断り（C57）で、
    // iOS には押す口がそもそも無い。**押したときの理由は、画面が受けて出す**（#33）。
  }),
);

/** **開けなかったのと、閉じられたのは別。** */
child.on('close', (code) => {
  session.abort(
    code === 0 || code === null
      ? '画面が閉じられた'
      : `画面を出せなかった（終了コード ${String(code)}）`,
  );
});

/**
 * **落ちても、人が置いた判定を失わない**（外部レビュー #2）。
 *
 * `abort` を通すので、残りのケースは**判断保留として残り**、証跡は完全な形で書ける。
 */
installSaveOnExit({
  on: (name, handler) => {
    process.on(name as NodeJS.Signals, handler);
  },
  save: async () => {
    session.abort('人が実行を止めた（Ctrl-C / 終了の合図）');
    // **開いた窓も片付ける**（#7）。残すと、次の実行が 1420 で死ぬ。
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
