import { createSheetCaseRunner, executeRun, sheetDestination } from '@git-qa/core';
import type {
  Actor,
  Run,
  RunCase,
  SheetRef,
  TargetAdapter,
  TargetSession,
  TestSpecSheet,
} from '@git-qa/core';

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
  });

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
