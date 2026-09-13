import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  createDesktopAdapter,
  createWindowsDesktopAdapter,
  readDesktopScreenText,
  whyNoDesktop,
} from '@git-qa/adapter-desktop';

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
import {
  compareSheet,
  findWorkspace,
  parseTestSpecTsv,
  runsRootIn,
  saveRunProgress,
  sheetDigest,
  sheetPathIn,
} from '@git-qa/core';
import type { Run } from '@git-qa/core';

import { spawnDesktop, tauriDevArgs, assertDesktopPortFree } from './app.js';
import { findSheets, keepRunnableSheets, newestFirst, sheetSearchRoots } from './find-sheets.js';
import { fromInvocationDir, runsDir } from './paths.js';
import { findInput, findOcr, findWinTool } from './ocr-path.js';
import { findUnfinishedRuns, readRun } from './resume.js';
import { startRunSession } from './run-session.js';
import { gitQaWindowRecording } from './window-recording.js';
import { imageTools } from './image-tools.js';
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

const winToolPath = await findWinTool();

/** デスクトップアプリを見るアダプタ。**OS ごとに別のもの。** */
const desktopAdapterFor = (app: string) => {
  const why = whyNoDesktop(process.platform, winToolPath);
  if (why !== undefined) throw new Error(why);

  const build = { source: app, label: process.env['GIT_QA_APP_LABEL'] ?? 'dev' };
  if (process.platform === 'win32') {
    // `whyNoDesktop` が通っているので、道具は在る。
    return createWindowsDesktopAdapter({ app, build, toolPath: winToolPath as string });
  }
  return createDesktopAdapter({
    app,
    build,
    // **同梱の OCR を既定で使う**（段 2・C55）。無ければ段 1 だけで動く。
    ...(ocrPath === undefined ? {} : { ocrPath }),
    // **前面に出さずに押す道具**（C57 追記）。無ければ前面へ出す道へ落ちる。
    ...(inputPath === undefined ? {} : { inputPath }),
  });
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

  /**
   * **途中で止まった実行を、画面へ出す**（2026-09-12・人の指示）。
   *
   * 探すのは 2 か所 —— **打った場所の `runs/`** と、**見つかったシートの家**。
   * ワークスペースを作った人は家の中に、作っていない人は打った場所に積まれている。
   */
  findResumable: async () => {
    const sheetPaths = await keepRunnableSheets(
      (await Promise.all(sheetRoots.map((root) => findSheets(root)))).flat(),
    );
    const homes = new Set<string>([runsDir('runs')]);
    for (const path of sheetPaths) {
      const workspace = findWorkspace(path, existsSync);
      if (workspace !== undefined) homes.add(runsRootIn(workspace));
    }

    const found = (await Promise.all([...homes].map((root) => findUnfinishedRuns(root)))).flat();
    // **新しいものが先。**人が探すのは、だいたい直前に止めたもの。
    return found.sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));
  },

  findSheets: async () =>
    newestFirst(
      await keepRunnableSheets(
        (await Promise.all(sheetRoots.map((root) => findSheets(root)))).flat(),
      ),
      SHEET_LIMIT,
    ),

  /**
   * **OS でデスクトップの見方を振り分ける**（2026-09-12）。
   *
   * macOS と Windows は別のソース（2026-09-07 の人の指定）。
   * **持っていない OS では、持っていないと言う** —— 「映らない」と
   * 「そもそも見られない」は、人にとってまるで別のこと。
   */
  start: async ({ serial, sheetPath, operator, browser, browserPath, watch, resume }) => {
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

    /**
     * **試験 1 本を、1 つのフォルダにまとめる**（2026-09-12・人の指示）。
     *
     * > 試験 tsv 画像動画がひとつのワークスペースにまとまっているみたいな。
     * > そっちの方が試験単位の git 管理も便利です
     *
     * シートの近くに `git-qa.json` があれば、**そこがその試験の家。**
     * 証跡はその `runs/` へ置き、シートの場所は**家からの相対**で書く
     * （絶対パスだと、証跡に個人名が混ざる・§25）。
     *
     * **印が無ければ、今までどおり**（打った場所の `runs/`）。
     */
    const workspace = findWorkspace(sheetPath, existsSync);
    const runsRoot = workspace === undefined ? runsDir('runs') : runsRootIn(workspace);

    /**
     * **続きから**（2026-09-12・人の指示）。
     *
     * 止まった実行を読み、**同じ実行に足す。**新しい実行にすると証跡が 2 本に割れる。
     * **シートが変わっていたら足さない** —— 昨日の判定は、いまの文面に対して
     * 置かれたものではない。
     */
    const previous =
      resume === undefined ? undefined : await readRun(join(runsRoot, resume, 'run.json'));
    if (resume !== undefined && previous === undefined) {
      throw new Error(`続きから走らせる証跡が読めない: ${join(runsRoot, resume, 'run.json')}`);
    }
    if (previous !== undefined) {
      const check = compareSheet(previous.sheet, text);
      if (check.kind !== 'same') {
        throw new Error(`続きから走らせられない: ${check.reason}`);
      }
    }

    const runId = previous?.runId ?? runIdFrom(new Date());

    /**
     * **鑑賞モードでは git-qa の窓を録る**（2026-09-11・人の判断）。
     *
     * > 録画ですが、git-qa を最大化して、そのアプリを録画するとどうですか？
     *
     * 相手のアプリだけ録っても、判定の根拠は写らない。
     * **道具が無ければ録らないだけ**（`unsupported` が証跡に残る）。
     */
    const recording =
      watch === true
        ? await gitQaWindowRecording({
            runsRoot,
            runId,
            tools: imageTools(),
            onNote: (text) => console.log(`[git-qa] ${text}`),
          })
        : undefined;

    session = await startRunSession({
      adapter:
        app !== undefined
          ? desktopAdapterFor(app)
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
        // **家からの相対。**絶対パスだと、証跡に個人名が混ざる（§25）。
        path: workspace === undefined ? sheetPath : sheetPathIn(workspace, sheetPath),
        sha256: sheetDigest(text),
        ...(sheet.meta['タイトル'] === undefined ? {} : { title: sheet.meta['タイトル'] }),
        ...(sheet.meta['文書番号'] === undefined ? {} : { documentNumber: sheet.meta['文書番号'] }),
      },
      runId,
      sheetPath,
      ...(previous === undefined ? {} : { previous }),
      // **鑑賞モード。**押さなくても 1 件ごとに間をおいて進む（止める口はある）。
      ...(watch === true ? { watch: {} } : {}),
      ...(recording === undefined ? {} : { recording }),
      // **置いた人。**画面から受け取る。無ければ環境変数、それも無ければ unknown
      // （unknown のまま残ると「誰が保証したか」が読めないので、画面側で入力を促す）。
      operator: { handle: operator ?? process.env['GIT_QA_OPERATOR'] ?? 'unknown' },
      readScreenText:
        app !== undefined ? readDesktopScreenText : web ? readWebScreenText : readAndroidScreenText,
      // **保存は実行の一部。**配布物（--serve）には書く処理が無く、人が置いた判定が
      // どこにも残らないまま終わっていた（2026-09-04・実機で踏んだ）。
      // 動画は既定で Git に入れない（C29）。`runs/` は .gitignore にある。
      saveRun: async (run) => {
        const path = await saveRunProgress(runsRoot, run);
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
      /**
       * **終わったことを入口へ知らせる**（外部レビュー meta-taro/git-qa#5）。
       *
       * これが無いと、入口は `running` のまま戻らず、
       * **1 本走らせたあとは立て直すまで次を受け取れなかった。**
       *
       * 落ちて終わった場合も「終わった」。次を受け取れる形へ戻す。
       */
      done: finished.catch(() => undefined),
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
  /**
   * **起こす前に、口が空いているかを見る**（外部レビュー meta-taro/git-qa#7）。
   *
   * 掴まれたまま起こすと、vite の「Port 1420 is already in use」で死ぬ。
   * **その文言からは、掴んでいるのが誰か分からない。**
   */
  await assertDesktopPortFree();
  const child = spawnDesktop(tauriDevArgs(undefined, { setupUrl: setup.url }));

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
