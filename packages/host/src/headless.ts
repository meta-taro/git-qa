import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  DATE_FORMAT_KEY,
  caseDir,
  createSheetCaseRunner,
  executeRun,
  framesToWebmCommand,
  sheetDestination,
} from '@git-qa/core';
import type {
  Actor,
  CaseContext,
  CaseVerdict,
  ExecuteRunOptions,
  Run,
  RunCase,
  SheetRef,
  TargetAdapter,
  TargetSession,
  TestSpecSheet,
} from '@git-qa/core';

import { createFrameRecording } from './frame-recording.js';
import { imageTools } from './image-tools.js';

/** ライブ映像の枚数（橋が流す速さ）。**動画の長さを出すのに要る。** */
const LIVE_FPS = 8;
/** 溜めた絵の置き場所。**繋いだあとは消す。** */
const FRAMES_DIR = 'frames';
const WEBM_NAME = 'screen.webm';

const runTool = promisify(execFile);

/**
 * **無人で流した結果を、人が開く前に読めるようにする**（外部レビュー meta-taro/git-qa#21）。
 *
 * > 夜間にひととおり流して、**落ちた行と証跡だけを朝に人が見る**
 *
 * **人の判断の代替ではない。**出るのは `AUTO_PASS` 止まりで、
 * `VERIFIED` は型として書けない（C17）。ここで決めるのは
 * **「朝に人が開くべきものが在るか」**だけ。
 */

/** 落ちた行が在れば 1、人が見ないと決まらない行が在れば 2、どちらも無ければ 0。 */
export function headlessExitCode(cases: readonly RunCase[]): number {
  // **空の実行を「通った」と読ませない。**1 件も走っていないのは、通ったのとは違う。
  if (cases.length === 0) return 2;
  if (cases.some((entry) => entry.result === 'FAIL')) return 1;
  if (cases.some((entry) => entry.result === 'BLOCKED')) return 2;
  return 0;
}

/** 内訳。**`VERIFIED` は出ない**（無人の実行に「人が見た」は在りえない）。 */
export function headlessSummary(cases: readonly RunCase[]): string {
  const count = (result: RunCase['result']): number =>
    cases.filter((entry) => entry.result === result).length;

  return (
    `${String(cases.length)} 件 — ` +
    `AUTO_PASS ${String(count('AUTO_PASS'))} / ` +
    `FAIL ${String(count('FAIL'))} / ` +
    `BLOCKED ${String(count('BLOCKED'))} / ` +
    `SKIP ${String(count('SKIP'))}`
  );
}

export interface RunHeadlessOptions {
  /**
   * **動画を残す**（meta-taro/git-qa#31）。頼まれたときだけ録る。
   *
   * 既定で録らないのは、**夜間に何本も流すと黙って場所を食う**から（C20）。
   * 録らなかったことは `not_requested` として証跡に残る ——
   * **「録れなかった」と混ぜない。**
   */
  readonly record?: boolean;
  readonly adapter: TargetAdapter;
  readonly sheet: TestSpecSheet;
  readonly sheetRef: SheetRef;
  readonly runId: string;
  readonly runsRoot: string;
  readonly operator: Actor;
  readonly readScreenText: (session: TargetSession) => Promise<string>;
}

/**
 * **誰も見ていない実行**（外部レビュー meta-taro/git-qa#21）。
 *
 * 画面を起こさない・映像の橋も張らない。**人に聞く口（`askHuman`）を渡さない**ので、
 * 結果は `AUTO_PASS` 止まりになる —— **`VERIFIED` は型として書けない**（C17）。
 *
 * **証跡には `mode: "auto"` が残る。**朝にこれを開く人が、
 * **どの行を人が見て、どの行を機械が流しただけなのか**を取り違えないため。**ここは緩めない。**
 */
export async function runHeadless(options: RunHeadlessOptions): Promise<Run> {
  const runner = createSheetCaseRunner({
    readScreenText: options.readScreenText,
    ...(sheetDestination(options.sheet.meta) === undefined
      ? {}
      : { app: sheetDestination(options.sheet.meta) as string }),
    // **相手が名乗った能力をそのまま渡す。**（`run-session.ts` と同じ考え方）
    textInput: options.adapter.capabilities.textInput,
    keyInput: options.adapter.capabilities.keyInput,
    appId: options.adapter.capabilities.appId,
    // **画面の日付の書き方はシートが決める**（#29）。
    ...(options.sheet.meta[DATE_FORMAT_KEY] === undefined
      ? {}
      : { dateFormat: options.sheet.meta[DATE_FORMAT_KEY] }),
  });

  /**
   * **無人でも動画を残す**（#31）。
   *
   * 無人では映像の橋を張らないので、**ここで自分で映像を開いて流す。**
   * 相手の画面そのものを録るので、**窓が要らない**（`--no-ui` でも録れる）。
   */
  if (options.record === true) {
    const session = await options.adapter.connect();
    try {
      return await runWithFrames(session, runner, options);
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  return executeRun({
    runId: options.runId,
    sheet: options.sheet,
    sheetRef: options.sheetRef,
    adapter: options.adapter,
    operator: options.operator,
    mode: 'auto',
    runCase: runner,
    // **渡すと、1 件終わるたびに書く。**途中で落ちても、そこまでが残る。
    runsRoot: options.runsRoot,
    onProgressError: (reason) => {
      console.error(`[git-qa] 途中経過を書けなかった: ${reason}`);
    },
  });
}

/**
 * 映像を開いて流しながら走らせる（#31）。
 *
 * **1 枚ずつの絵で流れる相手だけ**（ウェブ・デスクトップ）。
 * Android は H.264 で流れ、**そちらは元から録画を持っている。**
 */
async function runWithFrames(
  session: TargetSession,
  runner: (ctx: CaseContext) => Promise<CaseVerdict>,
  options: RunHeadlessOptions,
): Promise<Run> {
  const view = session.liveView;
  const frames = view.frames?.bind(view);
  if (frames === undefined || view.transport.kind !== 'image-frames') {
    console.error('[git-qa] この相手は 1 枚ずつの絵で映らないので、録画しない（動画は残らない）');
    return executeRun({ ...baseOptions(options), session, runCase: runner });
  }

  const recording = createFrameRecording({
    dirFor: (caseNo) => join(caseDir(options.runsRoot, options.runId, caseNo), FRAMES_DIR),
    ensureDir: async (dir) => {
      await mkdir(dir, { recursive: true });
    },
    writeFrame: (path, bytes) => writeFile(path, bytes),
    toWebm: async (dir, count) => {
      const command = framesToWebmCommand(
        imageTools(),
        join(dir, '%05d.jpg'),
        join(dir, '..', WEBM_NAME),
        LIVE_FPS,
      );
      // **道具が無い。**絵は残してある（持っていない、と言う）。
      if (command === undefined) return undefined;
      await runTool(command.command, command.args);
      console.error(`[git-qa] ${String(count)} 枚を動画にした`);
      return { name: WEBM_NAME };
    },
    removeFrames: (dir) => rm(dir, { recursive: true, force: true }),
    now: () => new Date(),
    fps: LIVE_FPS,
  });

  await view.open();
  let pumping = true;
  const pump = (async () => {
    try {
      for await (const bytes of frames()) {
        if (!pumping) return;
        recording.accept(bytes);
      }
    } catch {
      // 映像が止まっただけ。**走行は止めない**（証跡に「録れなかった」が残る）。
    }
  })();

  try {
    return await executeRun({ ...baseOptions(options), session, runCase: runner, recording });
  } finally {
    pumping = false;
    await view.close().catch(() => undefined);
    await pump.catch(() => undefined);
  }
}

/** 無人で走らせるときの、共通の渡しもの。 */
function baseOptions(options: RunHeadlessOptions): Omit<ExecuteRunOptions, 'runCase'> {
  return {
    runId: options.runId,
    sheet: options.sheet,
    sheetRef: options.sheetRef,
    operator: options.operator,
    mode: 'auto',
    runsRoot: options.runsRoot,
    onProgressError: (reason) => {
      console.error(`[git-qa] 途中経過を書けなかった: ${reason}`);
    },
  };
}
