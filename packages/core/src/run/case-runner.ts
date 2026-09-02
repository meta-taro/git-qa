import type { TargetSession } from '../adapter/types.js';
import type { TestSpecSheet } from '../tsv/types.js';
import type { CaseContext, CaseVerdict } from './execute.js';
import type { PlannedAction, PlannedStep } from './steps.js';
import { judgeExpectation, planExpectation, planSteps } from './steps.js';

/**
 * 検証シートの 1 行を実際に動かして、AI の判定を出す。
 *
 * **AI が `PASS` / `FAIL` を出せるのは、期待結果が機械で見られるときだけ。**
 * 落とせない手順・見られない期待結果・端末側の失敗は、すべて `BLOCKED`（判断保留）にして
 * 人へ渡す。**控えめに倒す。**AI が推測で `PASS` を積むと、人が見ていない `AUTO_PASS` が
 * 増えるだけで、この製品の意味（誰が保証したかが残る）が薄れる。
 */

/** 検証シートの列名。テンプレートは全リポ共通なので、ここに固定で持つ。 */
export const STEPS_COLUMN = '手順';
export const EXPECTATION_COLUMN = '期待結果';

export interface SheetCaseRunnerOptions {
  /**
   * 画面から読める文字を取る。**対象ごとに形が違うのでコアは知らない**
   * （Android のアクセシビリティツリーと Web の DOM は同じものではない・C8）。
   */
  readonly readScreenText: (session: TargetSession) => Promise<string>;
  readonly stepsColumn?: string;
  readonly expectationColumn?: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 繋ぐ前にシートを見る。**繋いでから落ちると、対象を触った跡だけが残る**（`toCaseSubjects` と同じ）。
 */
export function assertRunnableSheet(
  sheet: TestSpecSheet,
  options: { stepsColumn?: string; expectationColumn?: string } = {},
): void {
  const names = sheet.columns.map((c) => c.name);
  const required = [
    options.stepsColumn ?? STEPS_COLUMN,
    options.expectationColumn ?? EXPECTATION_COLUMN,
  ];
  for (const column of required) {
    if (!names.includes(column)) {
      throw new Error(`検証シートに「${column}」列が無い（列: ${names.join(' / ')}）`);
    }
  }
}

/** 落とせなかった手順をまとめる。**1 つでもあれば端末に触らない。** */
function holdBeforeTouching(steps: PlannedStep[]): CaseVerdict | undefined {
  const reasons = steps.filter(
    (s): s is Extract<PlannedStep, { kind: 'hold' }> => s.kind === 'hold',
  );
  if (reasons.length === 0) return undefined;
  return {
    aiResult: 'BLOCKED',
    note: [
      '手順を操作へ落とせないので、人が操作する必要がある',
      ...reasons.map((r) => r.reason),
    ].join('\n'),
  };
}

/** 順に操作する。落ちたら、どの手順で落ちたかを返す。 */
async function actAll(ctx: CaseContext, steps: PlannedAction[]): Promise<string | undefined> {
  for (const step of steps) {
    ctx.step(step.text);
    try {
      await ctx.session.act(step.action);
    } catch (error: unknown) {
      return `「${step.text}」で止まった: ${errorMessage(error)}`;
    }
  }
  return undefined;
}

export function createSheetCaseRunner(
  options: SheetCaseRunnerOptions,
): (ctx: CaseContext) => Promise<CaseVerdict> {
  const stepsColumn = options.stepsColumn ?? STEPS_COLUMN;
  const expectationColumn = options.expectationColumn ?? EXPECTATION_COLUMN;

  return async (ctx: CaseContext): Promise<CaseVerdict> => {
    const planned = planSteps(ctx.subject.row.cells[stepsColumn] ?? '');
    const held = holdBeforeTouching(planned);
    if (held !== undefined) return held;

    // ここまで来た時点で hold は無い。型の上でも落として、キャストを持ち込まない。
    const actions = planned.filter((step): step is PlannedAction => step.kind === 'action');
    const failure = await actAll(ctx, actions);
    if (failure !== undefined) {
      return { aiResult: 'BLOCKED', note: failure };
    }

    const expectation = planExpectation(ctx.subject.row.cells[expectationColumn] ?? '');
    if (expectation.kind === 'hold') {
      // 操作は済んでいる。**人がライブで見て判断できる所まで進めるのが AI の仕事。**
      return { aiResult: 'BLOCKED', note: expectation.reason };
    }

    let screenText: string;
    try {
      screenText = await options.readScreenText(ctx.session);
    } catch (error: unknown) {
      // 画面が読めないまま通さない。**読めなかったことは「通った」ではない。**
      return { aiResult: 'BLOCKED', note: `画面の文字を読めない: ${errorMessage(error)}` };
    }

    const aiResult = judgeExpectation(expectation, screenText);
    const note =
      aiResult === 'PASS'
        ? `画面の文字に「${expectation.text}」が在ることだけを見た`
        : `画面の文字に「${expectation.text}」が無い`;
    return { aiResult, note };
  };
}
