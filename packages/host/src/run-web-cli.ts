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
  viewportLabel,
  type TargetAdapter,
  type Viewport,
} from '@git-qa/core';

import { installSaveOnExit } from './save-on-exit.js';
import { startRunSession, type RunSession } from './run-session.js';
import { runHomeFor } from './paths.js';
import { positional } from './argv.js';
import { headlessExitCode, headlessSummary, runHeadless } from './headless.js';
import { spawnDesktop, tauriDevArgs, assertDesktopPortFree, killTree } from './app.js';
import { combineExitCodes, resolveViewports, runIdFor, VIEWPORT_FLAG } from './viewports.js';

/**
 * ウェブページで検証シートを 1 本走らせる（Issue 015 / C54）。
 *
 *   pnpm run:sheet:web <検証シート.tsv>
 *   pnpm run:sheet:web <検証シート.tsv> --viewport 390x844,1440x900
 *
 * 行き先はシートの見出し `# 対象:` が宣言した URL。**ここで別の場所へ行かない**（C40）。
 * 表示領域の大きさはシートの `# 画面:` か `--viewport`（C122）。複数あれば**幅ごとに run を分けて**順に回す。
 *
 * **ここは配線なので検査していない。**判断のある所（手順の解釈・判断保留の条件・
 * 打鍵の受け渡し・遷移・大きさの読み方）は `@git-qa/core` と `run-session.ts`・`viewports.ts` にあり、
 * そちらは検査してある。
 */

/**
 * **AI が触った場所・人が見る場所を、画面へ流す道**（要望シート No.1・2026-09-24）。
 * アダプタは実行器より先に作るので、知らせ先を後から預ける形にする。
 */
let reportPointed:
  | ((at: { x: number; y: number; width?: number; height?: number; label?: string }) => void)
  | undefined;

const sheetPath = positional(process.argv, 0) ?? process.env['GIT_QA_SHEET'];
if (sheetPath === undefined) {
  console.error('使い方: pnpm run:sheet:web <検証シート.tsv> [--no-ui] [--viewport 390x844]');
  process.exit(1);
}

/** `20260902-150000`。人が ls で並べ替えられる形にする。 */
const runIdFrom = (at: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${String(at.getFullYear())}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `${date}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
};

/**
 * 人が打った場所を基準に解決する（pnpm --filter は cwd をパッケージへ移す）。
 * **証跡は試験の家へ出す** —— シートの近くに `git-qa.json` があればその `runs/`（画面から始める道と同じ）。
 */
const home = runHomeFor(sheetPath);
const resolvedSheet = home.sheetPath;

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

/**
 * **表示領域の大きさ**（C122）。シートの `# 画面:` か `--viewport`。
 * **読めない書き方は、走らせる前に止める**（黙って既定に落とさない・C20）。
 */
let viewports: Viewport[] | undefined;
try {
  viewports = resolveViewports(process.argv, sheet.meta);
} catch (error) {
  console.error(`[git-qa] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (viewports !== undefined && kind === 'safari') {
  // Safari の口（WebDriver）には表示領域を直接合わせる手が無い。**黙って窓のまま見ない。**
  console.error(
    `[git-qa] Safari ではまだ表示領域の大きさを合わせられない。「# ${'画面'}:」と ${VIEWPORT_FLAG} を外すか、Chrome / Firefox で見る`,
  );
  process.exit(1);
}

/** 1 つの大きさで見るアダプタ。**大きさが無ければ今までどおりの窓。** */
const makeAdapter = (viewport: Viewport | undefined): TargetAdapter =>
  kind === 'safari'
    ? createSafariAdapter({
        // **触った場所・見る場所を画面へ流す**（要望シート No.1・2026-09-25）。
        onPointed: (at) => reportPointed?.(at),
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
          // **表示領域はシートか引数が決める**（C122）。
          ...(viewport === undefined ? {} : { viewport }),
          ...(process.env['GIT_QA_BROWSER'] === undefined
            ? {}
            : { firefoxPath: process.env['GIT_QA_BROWSER'] }),
        })
      : createWebAdapter({
          // **触った場所・見る場所を画面へ流す**（要望シート No.1・2026-09-24）。
          onPointed: (at) => reportPointed?.(at),
          build: { source: subject ?? target, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' },
          /**
           * **何処を見に行くか**（#22）。`build.source` は「何を検証したか」なので、
           * **そこを URL として開かない** —— `owner/repo@branch` が入りうる。
           */
          url: target,
          destination: target,
          // 同じ幅で見ないと、崩れの有無を比べられない。
          size: { width: 1280, height: 900 },
          // **表示領域はシートか引数が決める**（C122）。窓ではなく Emulation で合わせる。
          ...(viewport === undefined ? {} : { viewport }),
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
           * **その中の、どのプロファイルか**（外部レビュー meta-taro/git-qa#35）。
           *
           * 普段使いの Chrome は、1 つの `user-data-dir` の中に複数のプロファイルを持つ
           * （報告者の機械では 19 個）。渡さないと `Default` が使われる ——
           * たいてい**いちばん私物のプロファイル**がそれ。
           */
          ...(process.env['GIT_QA_PROFILE_DIRECTORY'] === undefined
            ? {}
            : { profileDirectory: process.env['GIT_QA_PROFILE_DIRECTORY'] }),
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

const sheetRef = {
  path: home.sheetRefPath,
  // 実行後にシートが変わったら、突き合わせで分かるようにする。
  sha256: sheetDigest(text),
  ...(sheet.meta['タイトル'] === undefined ? {} : { title: sheet.meta['タイトル'] }),
  ...(sheet.meta['文書番号'] === undefined ? {} : { documentNumber: sheet.meta['文書番号'] }),
};
const operator = { handle: process.env['GIT_QA_OPERATOR'] ?? 'unknown' };

/**
 * **幅ごとに run を分ける**（C122）。1 本の `run.json` は 1 つの大きさで見たもの。
 * 大きさを決めていなければ、今までどおり 1 回。
 */
const rounds: (Viewport | undefined)[] = viewports ?? [undefined];
const baseRunId = runIdFrom(new Date());
const runIdOf = (viewport: Viewport | undefined): string =>
  runIdFor(baseRunId, viewport, rounds.length);
const sizeNote = (viewport: Viewport | undefined): string =>
  viewport === undefined ? '' : `（表示領域 ${viewportLabel(viewport)}）`;

/**
 * **誰も見ていない実行**（外部レビュー meta-taro/git-qa#21）。
 *
 * > 夜間にひととおり流して、**落ちた行と証跡だけを朝に人が見る**
 *
 * `--no-ui` で画面を起こさない。**出るのは `AUTO_PASS` 止まり**で、
 * `VERIFIED` は型として書けない（C17）。証跡には `mode: "auto"` が残る。
 */
if (process.argv.includes('--no-ui')) {
  const codes: number[] = [];
  for (const viewport of rounds) {
    const run = await runHeadless({
      adapter: makeAdapter(viewport),
      sheet,
      sheetRef,
      runId: runIdOf(viewport),
      runsRoot: home.runsRoot,
      // **動画は頼まれたときだけ**（#31）。夜間に何本も流すと、黙って場所を食う。
      ...(process.argv.includes('--record') ? { record: true } : {}),
      operator,
      readScreenText: readWebScreenText,
    });

    console.log(
      `[git-qa] 無人で走らせた（誰も見ていない）${sizeNote(viewport)}: ${headlessSummary(run.cases)}`,
    );
    console.log(`[git-qa] 証跡: ${home.runsRoot}/${run.runId}/run.json`);
    codes.push(headlessExitCode(run.cases));
  }
  // **朝に開くべきものが在るかを、終了コードで返す**（1 = 落ちた / 2 = 人が見ないと決まらない）。
  process.exit(combineExitCodes(codes));
}

/** いま走っているもの。**Ctrl-C で止めたとき、ここまでの判定を失わない**（外部レビュー #2）。 */
let current: { session: RunSession; child: ReturnType<typeof spawnDesktop> } | undefined;

/**
 * **落ちても、人が置いた判定を失わない**（外部レビュー #2）。
 *
 * `abort` を通すので、**そこまでの判定は証跡に残る。**走らせていない残りは書かない（続きから走らせられる）。
 * **拾える落ち方だけが対象。**`SIGKILL`・電源・親ごと消える、は救えない。
 */
installSaveOnExit({
  on: (name, handler) => {
    process.on(name as NodeJS.Signals, handler);
  },
  save: async () => {
    if (current === undefined) return;
    const { session, child } = current;
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
    const saved = await saveRunProgress(home.runsRoot, partial);
    console.log(`\n[git-qa] 途中で止めた。ここまでの証跡: ${saved}`);
  },
  exit: (code) => process.exit(code),
});

for (const viewport of rounds) {
  const session = await startRunSession({
    adapter: makeAdapter(viewport),
    // **映像の絵も、証跡と同じ家へ**（渡さないと、打った場所の runs/ へ割れる）。
    runsRoot: home.runsRoot,
    registerPointing: (report) => {
      reportPointed = report;
    },
    // **人が見ている実行でも動画を残す**（#31 の続き）。頼まれたときだけ。
    ...(process.argv.includes('--record') ? { record: true } : {}),
    sheet,
    sheetRef,
    runId: runIdOf(viewport),
    // 画面のメニューから開けるようにする。解決済みの絶対パスを渡す。
    sheetPath: resolvedSheet,
    operator,
    readScreenText: readWebScreenText,
  });

  console.log(`[git-qa] 見る場所: ${target}${sizeNote(viewport)}`);
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
  current = { session, child };

  /**
   * 画面が終わったら、そこで止めて終える。**走らせていない残りは証跡に書かない**（続きから走らせられる）。
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
  const path = await saveRunProgress(home.runsRoot, run);
  console.log(`[git-qa] 証跡: ${path}`);

  const placed = run.cases.filter((c) => c.verifiedBy !== undefined).length;
  console.log(
    `[git-qa] ${String(run.cases.length)} 件中 ${String(placed)} 件を人が見て置いた${sizeNote(viewport)}`,
  );

  // **木ごと止める。**`child.kill()` では下の `vite` が残る（#7）。
  killTree(child);
  current = undefined;

  /**
   * **次の幅は、窓を閉じ切ってから。**同じ 1420 を使うので、木が消える前に起こすと
   * 「Port 1420 is already in use」で止まる（#7 と同じ穴）。
   */
  if (viewport !== rounds[rounds.length - 1]) {
    await new Promise<void>((resolve) => {
      child.once('close', () => resolve());
      if (child.exitCode !== null) resolve();
    });
  }
}
