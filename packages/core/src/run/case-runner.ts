import type { TargetSession } from '../adapter/types.js';
import type { TestSpecSheet } from '../tsv/types.js';
import type { AiResult } from './types.js';
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
/**
 * 期待結果が出るまで待つ長さ（外部レビュー meta-taro/git-qa#12）。
 *
 * **短すぎると、動いているものに `FAIL` が付く。**実例は 518 ms だった。
 * **長すぎると、落ちる実行が遅くなる** —— 通る場合は待たないので、ここは落ちる側の費用。
 */
const DEFAULT_EXPECTATION_WAIT_MS = 2000;
/** 読み直す間隔。 */
const DEFAULT_EXPECTATION_STEP_MS = 200;
/**
 * **最低でもこの回数は読む。**
 *
 * 1 回読むのに締切より長くかかる相手（デスクトップは実物で 7 秒）がいる。
 * 締切だけで切ると、**読み直しがいちばん要る相手に効かない。**
 */
const MIN_EXPECTATION_TRIES = 2;

/** 少し待つ。**検査では `stepMs` を小さくして待たせない。** */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const EXPECTATION_COLUMN = '期待結果';

export interface SheetCaseRunnerOptions {
  /**
   * 画面から読める文字を取る。**対象ごとに形が違うのでコアは知らない**
   * （Android のアクセシビリティツリーと Web の DOM は同じものではない・C8）。
   */
  readonly readScreenText: (session: TargetSession) => Promise<string>;
  /**
   * シートの見出し（`# 対象:`）が宣言した対象アプリの識別子。
   * 「アプリを起動する」の行き先になる。**無ければその手順は保留になる。**
   */
  readonly app?: string;
  /**
   * 文字をそのまま送れるか。**アダプタが名乗ったものをそのまま渡す**
   * （`AdapterCapabilities.textInput`）。ここで推し量らない。
   */
  readonly textInput?: 'none' | 'ascii-only' | 'any';
  /** キーを送れるか（`AdapterCapabilities.keyInput`）。ここで推し量らない。 */
  readonly keyInput?: boolean;
  /**
   * **期待結果が出るまで、少し読み直す**（外部レビュー meta-taro/git-qa#12）。
   *
   * **クリックは「押した」時点で返る。**相手はそこから仕事を始めるので、
   * 結果が出るのはそのあと。押した直後に 1 回だけ読んで無ければ `FAIL`、では
   * **動いているものが「壊れている」と記録される。**
   *
   * **出たら即座に進む**ので、通る場合は今までと同じ速さで終わる。
   * 落ちる場合だけ、ここに書いた分だけ余計にかかる。
   */
  readonly expectation?: { readonly waitMs?: number; readonly stepMs?: number };
  /** 行き先の書き方。**アダプタが名乗ったものをそのまま渡す。** */
  readonly appId?: 'package-or-url' | 'name';
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
    const planned = planSteps(ctx.subject.row.cells[stepsColumn] ?? '', {
      ...(options.app === undefined ? {} : { app: options.app }),
      // **相手が名乗った能力をそのまま使う。**ここで推し量らない。
      ...(options.textInput === undefined ? {} : { textInput: options.textInput }),
      ...(options.keyInput === undefined ? {} : { keyInput: options.keyInput }),
      ...(options.appId === undefined ? {} : { appId: options.appId }),
    });
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

    /**
     * **出るまで少し読み直す**（外部レビュー meta-taro/git-qa#12）。
     *
     * 実例では**クエリの実行に 518 ms** かかっていて、押した直後の 1 回では
     * 間に合っていなかった。**出たら即座に抜ける**ので、通る場合は今までと同じ速さ。
     */
    const waitMs = options.expectation?.waitMs ?? DEFAULT_EXPECTATION_WAIT_MS;
    const stepMs = options.expectation?.stepMs ?? DEFAULT_EXPECTATION_STEP_MS;
    const began = Date.now();
    const until = began + waitMs;

    let screenText: string;
    let aiResult: AiResult;
    let tries = 0;
    for (;;) {
      try {
        screenText = await options.readScreenText(ctx.session);
      } catch (error: unknown) {
        // 画面が読めないまま通さない。**読めなかったことは「通った」ではない。**
        return { aiResult: 'BLOCKED', note: `画面の文字を読めない: ${errorMessage(error)}` };
      }
      tries += 1;
      aiResult = judgeExpectation(expectation, screenText);
      if (aiResult === 'PASS') break;
      /**
       * **落ちると言う前に、必ずもう一度見る**（2026-09-14）。
       *
       * デスクトップの画面読みは**実物で 7 秒**かかる。締切だけで切ると、
       * **1 回目を読み終えた時点で既に過ぎていて**、読み直しが
       * **いちばん要る相手に効かない。**
       */
      if (tries >= MIN_EXPECTATION_TRIES && Date.now() >= until) break;
      await sleep(stepMs);
    }

    if (aiResult === 'PASS') {
      return { aiResult, note: `画面の文字に「${expectation.text}」が在ることだけを見た` };
    }
    /**
     * **待ち切ったことを書く。**
     *
     * > 一度も見なかったのか、待ったのに来なかったのかを区別しません。
     *
     * 分けて書けば、読んだ人は「まだ出ていないだけでは？」を自分で確かめられる。
     */
    /**
     * **どれだけ待って、何回見たかを出す。**
     *
     * 時間だけだと「何回見たか」が分からず、回数だけだと
     * 「まだ出ていないだけでは？」を人が判断できない。**両方要る。**
     * 時間は**実際にかかった分**（相手が遅ければ、決めた締切より長くなる）。
     */
    const spent = Math.round((Date.now() - began) / 100) / 10;
    const waited = tries > 1 ? `${String(spent)} 秒のあいだに ${String(tries)} 回見ても` : '';
    return {
      aiResult,
      note: `画面の文字に${waited}「${expectation.text}」が現れなかった`,
    };
  };
}
