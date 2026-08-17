import type { TargetAdapter, TargetSession } from '../adapter/types.js';
import { resolveCaseResult } from './result.js';
import type {
  Actor,
  AiResult,
  CaseRecording,
  Finding,
  HumanResult,
  Run,
  RunCase,
  RunMode,
  RunStep,
  SheetRef,
} from './types.js';
import { RUN_SCHEMA_VERSION } from './types.js';
import type { TestSpecSheet, TsvRow } from '../tsv/types.js';

/**
 * 検証シートを 1 本走らせて `run.json` の中身を作る。
 *
 * ここが決めるのは**順番と記録**だけ。何をどう操作するかは呼び出し側（`runCase`）、
 * 対象への繋ぎ方はアダプタ、人の判断は `askHuman` が持つ。
 *
 * **結果はこの戻り値にしか書かない。**検証シート TSV へは書き戻さない（decisions.md C3）。
 */

/** 検証シートの列名。テンプレートは全リポ共通なので、ここに固定で持つ。 */
export const CASE_NO_COLUMN = 'No.';
export const CASE_TITLE_COLUMN = '項目';

/** シートの 1 行を、走らせる 1 件として見たもの。 */
export interface CaseSubject {
  no: number;
  title: string;
  /** 手順・期待結果は行ごと渡す。どの列をどう読むかは呼び出し側が決める。 */
  row: TsvRow;
}

export interface CaseContext {
  readonly subject: CaseSubject;
  readonly session: TargetSession;
  /** 動画の頭出しに使う足跡を 1 つ置く。 */
  readonly step: (label?: string) => void;
}

/** AI が出す判定。`VERIFIED` は型として書けない（C17）。 */
export interface CaseVerdict {
  aiResult: AiResult;
  note?: string;
}

/** 人が出す判定。`AUTO_PASS` は型として書けない（C17）。 */
export interface HumanVerdict {
  humanResult: HumanResult;
  /** 名前を置いた人。個人名ではなくハンドル。 */
  by: string;
  note?: string;
}

export interface ExecuteRunOptions {
  runId: string;
  sheet: TestSpecSheet;
  /** 読んだシートの出どころ。ハッシュは読み込んだ側が持っている。 */
  sheetRef: SheetRef;
  adapter: TargetAdapter;
  operator: Actor;
  mode: RunMode;
  /** ケース 1 件を実際に動かす。操作は `ctx.session` 経由。 */
  runCase: (ctx: CaseContext) => Promise<CaseVerdict>;
  /**
   * 人に結果を置いてもらう。`undefined` が返ったら**人は見ていない**ということで、
   * `AUTO_PASS` になる。繰り上げない。
   */
  askHuman?: (ctx: CaseContext, verdict: CaseVerdict) => Promise<HumanVerdict | undefined>;
  /** 時刻の出どころ。既定は実時計。 */
  now?: () => Date;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const joinNotes = (...notes: (string | undefined)[]): string | undefined => {
  const kept = notes.filter((n): n is string => n !== undefined && n !== '');
  return kept.length === 0 ? undefined : kept.join('\n');
};

/**
 * 走らせる前にシートを読み切る。**繋いでから落ちると、対象を触った跡だけが残る。**
 */
export function toCaseSubjects(sheet: TestSpecSheet): CaseSubject[] {
  const names = sheet.columns.map((c) => c.name);
  for (const required of [CASE_NO_COLUMN, CASE_TITLE_COLUMN]) {
    if (!names.includes(required)) {
      throw new Error(`検証シートに「${required}」列が無い（列: ${names.join(' / ')}）`);
    }
  }

  const subjects: CaseSubject[] = [];
  const seen = new Map<number, number>();
  for (const row of sheet.rows) {
    const raw = row.cells[CASE_NO_COLUMN] ?? '';
    const no = Number(raw);
    if (!Number.isInteger(no) || no < 1) {
      throw new Error(`${row.line} 行目の No. が 1 以上の整数でない: ${JSON.stringify(raw)}`);
    }
    const first = seen.get(no);
    if (first !== undefined) {
      // ケースの置き場所が `case-001` のように No. で決まるので、重複すると証跡が上書きされる。
      throw new Error(`No. ${no} が ${first} 行目と ${row.line} 行目で重複している`);
    }
    seen.set(no, row.line);

    const title = (row.cells[CASE_TITLE_COLUMN] ?? '').trim();
    if (title === '') {
      throw new Error(`${row.line} 行目の「${CASE_TITLE_COLUMN}」が空`);
    }
    subjects.push({ no, title, row });
  }
  return subjects;
}

/** 設定同士の食い違いは、走らせる前に落とす。走ってからでは実行が 1 本無駄になる。 */
function assertModeMatchesAskHuman(mode: RunMode, hasAskHuman: boolean): void {
  if (mode === 'auto' && hasAskHuman) {
    throw new Error('mode が auto の実行では askHuman を渡せない（誰も見ない実行のはずなので）');
  }
  if (mode !== 'auto' && !hasAskHuman) {
    throw new Error(
      `mode が ${mode} の実行には askHuman が要る（無いと全ケースが AUTO_PASS になる）`,
    );
  }
}

async function stopRecording(session: TargetSession): Promise<CaseRecording> {
  try {
    return await session.recording.stop();
  } catch (error: unknown) {
    // 録画の後始末が失敗しても、ケースの合否は落とさない。**黙って握らず、理由を残す。**
    return { state: 'failed', reason: errorMessage(error) };
  }
}

async function runOneCase(
  subject: CaseSubject,
  session: TargetSession,
  options: ExecuteRunOptions,
  now: () => Date,
): Promise<RunCase> {
  const steps: RunStep[] = [];
  const ctx: CaseContext = {
    subject,
    session,
    step: (label?: string): void => {
      const at = now().toISOString();
      steps.push(
        label === undefined ? { index: steps.length, at } : { index: steps.length, at, label },
      );
    },
  };

  const startedAt = now().toISOString();
  if (session.recording.requested) {
    await session.recording.start(subject.no);
  }

  let verdict: CaseVerdict;
  try {
    verdict = await options.runCase(ctx);
  } catch (error: unknown) {
    // 1 件落ちても実行ごと止めない。止めると、残りのケースが「やっていない」ことすら残らない。
    verdict = { aiResult: 'FAIL', note: errorMessage(error) };
  }

  // 録画はケースの操作までで閉じる。人が考えている時間は動画に入れない。
  const recording = await stopRecording(session);

  const human = await options.askHuman?.(ctx, verdict);

  const finishedAt = now().toISOString();
  const result = resolveCaseResult(
    human === undefined
      ? { aiResult: verdict.aiResult }
      : { aiResult: verdict.aiResult, humanResult: human.humanResult },
  );
  const note = joinNotes(verdict.note, human?.note);

  return {
    no: subject.no,
    title: subject.title,
    startedAt,
    finishedAt,
    aiResult: verdict.aiResult,
    ...(human === undefined
      ? {}
      : { humanResult: human.humanResult, verifiedBy: human.by, verifiedAt: finishedAt }),
    result,
    steps,
    recording,
    ...(note === undefined ? {} : { note }),
  };
}

export async function executeRun(options: ExecuteRunOptions): Promise<Run> {
  const now = options.now ?? ((): Date => new Date());
  assertModeMatchesAskHuman(options.mode, options.askHuman !== undefined);
  const subjects = toCaseSubjects(options.sheet);

  const startedAt = now().toISOString();
  const session = await options.adapter.connect();
  const cases: RunCase[] = [];
  const findings: Finding[] = [];

  try {
    // 人が横で見られる状態にしてから走らせる（C4）。開けずに走ると、見る先が無い。
    await session.liveView.open();
    for (const subject of subjects) {
      cases.push(await runOneCase(subject, session, options, now));
    }
  } finally {
    await session.close();
  }

  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    runId: options.runId,
    startedAt,
    finishedAt: now().toISOString(),
    operator: options.operator,
    mode: options.mode,
    sheet: options.sheetRef,
    target: session.target,
    recording: { requested: session.recording.requested },
    cases,
    findings,
  };
}
