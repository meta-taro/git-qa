import { readFile } from 'node:fs/promises';

import {
  createFirefoxAdapter,
  createSafariAdapter,
  createWebAdapter,
  killLaunchedSync,
  readWebScreenText,
} from '@git-qa/adapter-web';
import {
  duplicateTargetMessage,
  parseTestSpecTsv,
  saveRunProgress,
  sheetDestination,
  sheetDigest,
  sheetSubject,
  verdictKeyHint,
} from '@git-qa/core';

import { installSaveOnExit } from './save-on-exit.js';
import { startRunSession } from './run-session.js';
import { fromInvocationDir } from './paths.js';
import { positional } from './argv.js';
import { headlessExitCode, headlessSummary, runHeadless } from './headless.js';
import { spawnDesktop, tauriDevArgs, assertDesktopPortFree, killTree } from './app.js';

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

const sheetPath = positional(process.argv, 0) ?? process.env['GIT_QA_SHEET'];
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
/** **行き先が 2 つ在るシートは走らせない**（#22）。宣言が 2 つあると C40 が成り立たない。 */
const duplicated = duplicateTargetMessage(sheet.duplicateMeta);
if (duplicated !== undefined) {
  console.error(`[git-qa] ${duplicated}`);
  process.exit(1);
}

const target = positional(process.argv, 1) ?? sheetDestination(sheet.meta);
if (target === undefined || !/^https?:\/\//.test(target)) {
  console.error(
    '[git-qa] 見る場所が分からない。シートの見出しに「# 対象: http://localhost:3000/」' +
      'か「# 行き先: http://localhost:3000/」を書くか、2 つ目の引数で URL を渡す',
  );
  process.exit(1);
}

/**
 * **何を検証したか**（外部レビュー meta-taro/git-qa#22）。
 *
 * `対象` に `owner/repo@branch` を書く運用がある。**行き先だけ残すと、
 * どのブランチを検証したのかが証跡から消える。**両方残す。
 */
const subject = sheetSubject(sheet.meta);

/**
 * **相手によって口が違う**（Issue 018）。
 * Chrome 系は CDP、Firefox は BiDi、Safari は WebDriver。**同じコードには乗らない。**
 */
const kind = process.env['GIT_QA_BROWSER_KIND'];

const adapter =
  kind === 'safari'
    ? createSafariAdapter({
        build: { source: subject ?? target, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
        /**
         * **何処を見に行くか**（#22）。`build.source` は「何を検証したか」なので、
         * **そこを URL として開かない** —— `owner/repo@branch` が入りうる。
         */
        url: target,
        destination: target,
      })
    : kind === 'firefox'
      ? createFirefoxAdapter({
          build: { source: subject ?? target, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
          /**
           * **何処を見に行くか**（#22）。`build.source` は「何を検証したか」なので、
           * **そこを URL として開かない** —— `owner/repo@branch` が入りうる。
           */
          url: target,
          destination: target,
          size: { width: 1280, height: 900 },
          ...(process.env['GIT_QA_BROWSER'] === undefined
            ? {}
            : { firefoxPath: process.env['GIT_QA_BROWSER'] }),
        })
      : createWebAdapter({
          build: { source: subject ?? target, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
          /**
           * **何処を見に行くか**（#22）。`build.source` は「何を検証したか」なので、
           * **そこを URL として開かない** —— `owner/repo@branch` が入りうる。
           */
          url: target,
          destination: target,
          // 同じ幅で見ないと、崩れの有無を比べられない。
          size: { width: 1280, height: 900 },
          /**
           * **ログイン済みの状態で見る**（外部レビュー meta-taro/git-qa#26）。
           *
           * 渡すと、そのプロファイルを使い、**終わりに消さない。**
           * **最初のログインは人が手で行う** —— git-qa は秘密情報を作らない・置かない（§14）。
           * **人が普段使っているプロファイルを渡さない**（検証で触られる）。
           */
          ...(process.env['GIT_QA_PROFILE'] === undefined
            ? {}
            : { userDataDir: process.env['GIT_QA_PROFILE'] }),
          /**
           * **既に起きているブラウザに繋ぐ**（meta-taro/git-qa#30）。
           *
           * Playwright が起こしたブラウザに繋げば、**前準備はそちら、判定はこちら**。
           * **起こさない・閉じない**（他人のものを片付けない）。
           */
          ...(process.env['GIT_QA_CDP'] === undefined
            ? {}
            : { attachTo: process.env['GIT_QA_CDP'] }),
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
        });

/**
 * **誰も見ていない実行**（外部レビュー meta-taro/git-qa#21）。
 *
 * > 夜間にひととおり流して、**落ちた行と証跡だけを朝に人が見る**
 *
 * `--no-ui` で画面を起こさない。**出るのは `AUTO_PASS` 止まり**で、
 * `VERIFIED` は型として書けない（C17）。証跡には `mode: "auto"` が残る。
 */
const sheetRef = {
  path: sheetPath,
  // 実行後にシートが変わったら、突き合わせで分かるようにする。
  sha256: sheetDigest(text),
  ...(sheet.meta['タイトル'] === undefined ? {} : { title: sheet.meta['タイトル'] }),
  ...(sheet.meta['文書番号'] === undefined ? {} : { documentNumber: sheet.meta['文書番号'] }),
};
const operator = { handle: process.env['GIT_QA_OPERATOR'] ?? 'unknown' };

if (process.argv.includes('--no-ui')) {
  const run = await runHeadless({
    adapter,
    sheet,
    sheetRef,
    runId: runIdFrom(new Date()),
    runsRoot: fromInvocationDir('runs'),
    // **動画は頼まれたときだけ**（#31）。夜間に何本も流すと、黙って場所を食う。
    ...(process.argv.includes('--record') ? { record: true } : {}),
    operator,
    readScreenText: readWebScreenText,
  });

  console.log(`[git-qa] 無人で走らせた（誰も見ていない）: ${headlessSummary(run.cases)}`);
  console.log(`[git-qa] 証跡: ${fromInvocationDir('runs')}/${run.runId}/run.json`);
  // **朝に開くべきものが在るかを、終了コードで返す**（1 = 落ちた / 2 = 人が見ないと決まらない）。
  process.exit(headlessExitCode(run.cases));
}

const session = await startRunSession({
  adapter,
  sheet,
  sheetRef,
  runId: runIdFrom(new Date()),
  // 画面のメニューから開けるようにする。解決済みの絶対パスを渡す。
  sheetPath: resolvedSheet,
  operator,
  readScreenText: readWebScreenText,
});

console.log(`[git-qa] 見る場所: ${target}`);
console.log(`[git-qa] ライブ映像の橋: ${session.liveUrl}`);
console.log(`[git-qa] 画面で ${verdictKeyHint()}`);

// **画面側では映像の種類を決められない。**ブラウザの絵だと知らせる（C54）。
/**
 * **起こす前に、口が空いているかを見る**（外部レビュー meta-taro/git-qa#7）。
 *
 * 掴まれたまま起こすと、vite の「Port 1420 is already in use」で死ぬ。
 * **その文言からは、掴んでいるのが誰か分からない。**
 */
await assertDesktopPortFree();
const child = spawnDesktop(
  tauriDevArgs(session.liveUrl, { controlUrl: session.controlUrl, liveKind: 'images' }),
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
     * **起こしたブラウザを、その場で落とす**（meta-taro/git-qa#20）。
     *
     * `close()` を辿る道だけでは足りない。**同じプロセスの vite も合図で終わる**ので、
     * 後始末が最後まで走らないことがある（2026-09-16 に実測。ブラウザだけ残った）。
     * **非同期を挟まずに落とす。**
     */
    killLaunchedSync();
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
