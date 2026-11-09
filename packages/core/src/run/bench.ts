/**
 * **楽になったことを数字で示す**（Issue 008・C48・C117）。
 *
 * この道具の生死を決めるのは「同じケース群を、手で通した時間より明確に短く通せたか」（C7）。
 * 手作業の時間は人がストップウォッチで測るしかないが、**道具側の所要時間と手数は証跡に残っている。**
 * ケースごとの開始・終了・判定の時刻、判定を置いた打鍵の回数（C49）、端末を触った回数。
 *
 * ここはそれを**読み出して 1 枚にする**だけで、何も新しく記録しない。
 * 古い証跡もそのまま読める。**無いものは「無い」と言い、0 で埋めない**（§19）。
 */

/** 数えるのに要る、証跡の最小限。**`run.json` を全部知らなくてよい。** */
export interface BenchRun {
  readonly runId: string;
  readonly startedAt: string;
  /** 走り切ったときにだけ在る（`types.ts` の約束）。 */
  readonly finishedAt?: string | undefined;
  readonly cases: readonly BenchCase[];
}

export interface BenchCase {
  readonly no: number;
  readonly title: string;
  readonly startedAt: string;
  readonly finishedAt?: string | undefined;
  readonly humanResult?: string | undefined;
  readonly verifiedAt?: string | undefined;
  readonly steps: readonly { readonly at: string }[];
  readonly humanActions?: readonly unknown[] | undefined;
  readonly humanInputs?: { readonly verdict: number; readonly advance: number } | undefined;
}

export interface CaseBench {
  readonly no: number;
  readonly title: string;
  /** 始まりから終わりまで。終わっていないケースには無い。 */
  readonly totalMs?: number;
  /** 始まりから、AI の最後の操作まで。操作が無ければ 0。 */
  readonly aiMs: number;
  /** AI の最後の操作から、人が判定を置くまで。人が置いていなければ無い。 */
  readonly humanMs?: number;
  readonly verdict: number;
  readonly advance: number;
  readonly touches: number;
}

export interface RunBench {
  readonly runId: string;
  readonly finished: boolean;
  readonly cases: number;
  /** 人が判定を置いた件数。 */
  readonly placed: number;
  /**
   * 所要時間（wall clock）。**AI の思考・待ちを外さない**（C48）。
   * 走り切っていなければ、終わっているケースの最後まで。終わったケースが無ければ無い。
   */
  readonly totalMs?: number;
  readonly perCaseMs?: { readonly mean: number; readonly median: number };
  readonly aiMs: number;
  readonly humanMs: number;
  /** `humanMs` に入っている件数（人が判定を置いたケース）。 */
  readonly humanMeasured: number;
  readonly inputs: { readonly verdict: number; readonly advance: number; readonly touches: number };
  /** 判定を 2 回以上置いたケースの No.。**多い所は、画面が分かりにくい所**（C49）。 */
  readonly redone: readonly number[];
  readonly longest?: CaseBench;
  readonly perCase: readonly CaseBench[];
}

const ms = (iso: string): number => Date.parse(iso);

function measureCase(one: BenchCase): CaseBench {
  const started = ms(one.startedAt);
  const lastStep = one.steps.length === 0 ? undefined : one.steps[one.steps.length - 1]?.at;
  const aiEnd = lastStep === undefined ? started : ms(lastStep);
  const base: CaseBench = {
    no: one.no,
    title: one.title,
    aiMs: Math.max(0, aiEnd - started),
    verdict: one.humanInputs?.verdict ?? 0,
    advance: one.humanInputs?.advance ?? 0,
    touches: one.humanActions?.length ?? 0,
  };
  const withTotal =
    one.finishedAt === undefined ? base : { ...base, totalMs: ms(one.finishedAt) - started };
  if (one.verifiedAt === undefined || one.humanResult === undefined) return withTotal;
  return { ...withTotal, humanMs: Math.max(0, ms(one.verifiedAt) - aiEnd) };
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return hi;
  return ((sorted[mid - 1] ?? 0) + hi) / 2;
}

/** 証跡 1 本を数える。**書き換えない。** */
export function measureRun(run: BenchRun): RunBench {
  const perCase = run.cases.map(measureCase);
  const done = perCase.filter((c): c is CaseBench & { totalMs: number } => c.totalMs !== undefined);
  const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

  // 走り切った実行は始まりから終わりまで。途中で止まったものは、終わっているケースの最後まで。
  let totalMs: number | undefined;
  if (run.finishedAt !== undefined) {
    totalMs = ms(run.finishedAt) - ms(run.startedAt);
  } else {
    const ends = run.cases.flatMap((c) => (c.finishedAt === undefined ? [] : [ms(c.finishedAt)]));
    totalMs = ends.length === 0 ? undefined : Math.max(...ends) - ms(run.startedAt);
  }

  const durations = done.map((c) => c.totalMs).sort((a, b) => a - b);
  const humanCases = perCase.filter((c) => c.humanMs !== undefined);
  const longest = done.reduce<CaseBench | undefined>(
    (best, c) => (best === undefined || c.totalMs > (best.totalMs ?? 0) ? c : best),
    undefined,
  );

  return {
    runId: run.runId,
    finished: run.finishedAt !== undefined,
    cases: run.cases.length,
    placed: run.cases.filter((c) => c.humanResult !== undefined).length,
    ...(totalMs === undefined ? {} : { totalMs }),
    ...(durations.length === 0
      ? {}
      : { perCaseMs: { mean: sum(durations) / durations.length, median: median(durations) } }),
    aiMs: sum(perCase.map((c) => c.aiMs)),
    humanMs: sum(humanCases.map((c) => c.humanMs ?? 0)),
    humanMeasured: humanCases.length,
    inputs: {
      verdict: sum(perCase.map((c) => c.verdict)),
      advance: sum(perCase.map((c) => c.advance)),
      touches: sum(perCase.map((c) => c.touches)),
    },
    redone: perCase.filter((c) => c.verdict >= 2).map((c) => c.no),
    ...(longest === undefined ? {} : { longest }),
    perCase,
  };
}

/** C48 の線。`pass` = 0.70 以下 / `fail` = 0.70 超〜1.00 / `slower` = 1.00 超。 */
export type ManualVerdict = 'pass' | 'fail' | 'slower';

export function compareToManual(
  toolMs: number,
  manualMs: number,
): { readonly ratio: number; readonly verdict: ManualVerdict } {
  if (!(manualMs > 0)) throw new Error('手作業の所要時間は 0 より大きい値で渡す');
  const ratio = Math.round((toolMs / manualMs) * 100) / 100;
  const verdict: ManualVerdict = ratio <= 0.7 ? 'pass' : ratio <= 1 ? 'fail' : 'slower';
  return { ratio, verdict };
}

/** 1 分未満は秒（小数 1 桁）、それ以上は「分 秒」。1 時間を超えたら時間も付ける。 */
export function formatMs(value: number): string {
  if (value < 60_000) return `${(Math.round(value / 100) / 10).toFixed(1)} 秒`;
  const total = Math.round(value / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = `${String(m)} 分 ${String(s).padStart(2, '0')} 秒`;
  return h === 0
    ? mm
    : `${String(h)} 時間 ${String(m).padStart(2, '0')} 分 ${String(s).padStart(2, '0')} 秒`;
}

const VERDICT_TEXT: Record<ManualVerdict, string> = {
  pass: '合格（C48 の線: 0.70 以下）',
  fail: '不合格（短いが明確ではない。C48 の線: 0.70 以下。ケースの内訳から一番食っている所を探す）',
  slower: '不合格（道具のほうが遅い。作り直しの範囲を決め直す）',
};

/**
 * 人が読める形にする。
 *
 * **所要を先に、内訳をその下に。**主指標は所要時間で、手数は差が出なかったときに
 * どこで食っているかを切り分ける内訳（C48）。
 */
export function renderBench(bench: RunBench, manualMs?: number): string {
  const lines: string[] = [];
  lines.push(
    `証跡 ${bench.runId}: ${String(bench.cases)} 件（人が置いた ${String(bench.placed)} 件）`,
  );
  if (!bench.finished) {
    lines.push(
      'この実行は途中で止まっている（終わりの時刻が無い）。所要は、終わっているケースの最後まで',
    );
  }

  if (bench.totalMs === undefined || bench.perCaseMs === undefined) {
    lines.push('所要: 出せない（終わったケースが無い）');
  } else {
    lines.push(
      `所要: ${formatMs(bench.totalMs)}（1 件あたり 平均 ${formatMs(bench.perCaseMs.mean)}・中央値 ${formatMs(bench.perCaseMs.median)}）`,
    );
    lines.push(
      `  うち AI が操作していた時間 ${formatMs(bench.aiMs)}、人の番だった時間 ${formatMs(bench.humanMs)}（判定を置いた ${String(bench.humanMeasured)} 件）`,
    );
  }

  const redone =
    bench.redone.length === 0
      ? ''
      : `（置き直したケース: No. ${bench.redone.map(String).join(', ')}）`;
  lines.push(
    `手数: 判定 ${String(bench.inputs.verdict)} 回・送り ${String(bench.inputs.advance)} 回・端末を触った ${String(bench.inputs.touches)} 回${redone}`,
  );

  if (bench.longest?.totalMs !== undefined) {
    lines.push(
      `いちばん長かったケース: No. ${String(bench.longest.no)}「${bench.longest.title}」${formatMs(bench.longest.totalMs)}`,
    );
  }

  if (bench.cases < 20) {
    lines.push('ケースが 20 件に満たない。1 ケースの当たり外れが全体を動かす（C48）');
  }

  if (manualMs !== undefined && bench.totalMs !== undefined) {
    const { ratio, verdict } = compareToManual(bench.totalMs, manualMs);
    lines.push(
      `手作業: ${formatMs(manualMs)} → 道具 ÷ 手作業 = ${ratio.toFixed(2)} → ${VERDICT_TEXT[verdict]}`,
    );
    lines.push('  注記を付けて残すこと: 手作業側は道具を知っている人が実施（C48）');
  }

  return lines.join('\n');
}
