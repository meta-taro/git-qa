import { AI_RESULTS, CASE_RESULTS, HUMAN_RESULTS } from '../run/types.js';
import type { AiResult, CaseResult, HumanResult } from '../run/types.js';

/**
 * 画面（webview）と実行器（Node）の間でやりとりする形。**両側の正本はここ。**
 *
 * 橋（`@git-qa/live-bridge`）は中身を知らずに運ぶので、**受け取る側が必ず検証する。**
 * 形の違うものを黙って受け取ると、`run.json` に人が置いていない判定が入りうる。
 */

/** 画面に出ている 1 ケース。 */
export interface SessionCase {
  readonly no: number;
  readonly title: string;
  /** AI が出した判定。まだ走っていないケースは持たない。 */
  readonly aiResult?: AiResult;
  /** 確定した最終結果。人が置くか、実行が次へ進んだ時点で決まる。 */
  readonly result?: CaseResult;
  readonly verifiedBy?: string;
  readonly note?: string;
}

/** `running` = AI が操作中 / `waiting` = 人の打鍵待ち / `finished` = 実行が終わった */
export type SessionPhase = 'running' | 'waiting' | 'finished';

export interface SessionState {
  readonly runId: string;
  readonly phase: SessionPhase;
  /** 人の判定を待っているケース番号。待っていなければ持たない。 */
  readonly awaiting?: number;
  readonly cases: readonly SessionCase[];
}

/** 画面から実行器へ送る、打鍵 1 回分。 */
export type HumanInput =
  | { readonly kind: 'verdict'; readonly caseNo: number; readonly humanResult: HumanResult }
  /** 人が判定を置かずに次へ送った。**繰り上げない**ので、結果は `AUTO_PASS` になる。 */
  | { readonly kind: 'advance'; readonly caseNo: number }
  /**
   * 人がライブビューの中を触った。座標は**端末の画素**（画面の表示寸法ではない）。
   *
   * **AI が判断保留にして止まった後、人が自分で触って確かめる**のが中心の動き。
   * 見えるが触れない画面は、判断の材料にならない。
   */
  | { readonly kind: 'tap'; readonly caseNo: number; readonly x: number; readonly y: number };
// **取り消しはまだ無い。**確定したケースを開け直す仕組みが要る（Issue 004 の既知の穴）。

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** ケース番号は置き場所（`case-001`）になるので、1 以上の整数だけを通す。 */
const isCaseNo = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

/** 画面上の位置。0 以上の整数だけを通す。 */
const isPixel = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

export function parseHumanInput(raw: unknown): HumanInput | undefined {
  if (!isRecord(raw)) return undefined;

  if (!isCaseNo(raw['caseNo'])) return undefined;
  const caseNo = raw['caseNo'];

  if (raw['kind'] === 'advance') return { kind: 'advance', caseNo };

  if (raw['kind'] === 'tap') {
    const { x, y } = raw;
    // 端末は画素の位置しか受け取らない。**丸めずに捨てる**（どこを押したのかが曖昧なまま
    // 端末を触ると、証跡と実際がずれる）。
    if (!isPixel(x) || !isPixel(y)) return undefined;
    return { kind: 'tap', caseNo, x, y };
  }

  if (raw['kind'] === 'verdict' && isOneOf(HUMAN_RESULTS, raw['humanResult'])) {
    // `AUTO_PASS` はここを通らない。**人が置ける値ではない**（C17）。
    return { kind: 'verdict', caseNo, humanResult: raw['humanResult'] };
  }
  return undefined;
}

const PHASES: readonly SessionPhase[] = ['running', 'waiting', 'finished'];

function parseCase(raw: unknown): SessionCase | undefined {
  if (!isRecord(raw) || !isCaseNo(raw['no']) || typeof raw['title'] !== 'string') return undefined;

  const optional = <T extends string>(values: readonly T[], key: string): T | undefined | null => {
    const value = raw[key];
    if (value === undefined) return undefined;
    return isOneOf(values, value) ? value : null;
  };

  const aiResult = optional(AI_RESULTS, 'aiResult');
  const result = optional(CASE_RESULTS, 'result');
  if (aiResult === null || result === null) return undefined;

  const text = (key: string): string | undefined =>
    typeof raw[key] === 'string' ? raw[key] : undefined;

  return {
    no: raw['no'],
    title: raw['title'],
    ...(aiResult === undefined ? {} : { aiResult: aiResult }),
    ...(result === undefined ? {} : { result: result }),
    ...(text('verifiedBy') === undefined ? {} : { verifiedBy: text('verifiedBy') as string }),
    ...(text('note') === undefined ? {} : { note: text('note') as string }),
  };
}

export function parseSessionState(raw: unknown): SessionState | undefined {
  if (!isRecord(raw) || typeof raw['runId'] !== 'string') return undefined;
  if (!isOneOf(PHASES, raw['phase'])) return undefined;
  if (!Array.isArray(raw['cases'])) return undefined;

  const cases: SessionCase[] = [];
  for (const item of raw['cases']) {
    const parsed = parseCase(item);
    // 1 件でも読めないなら、全部を捨てる。**半分だけ読めた一覧は、人を誤らせる。**
    if (parsed === undefined) return undefined;
    cases.push(parsed);
  }

  const awaiting = raw['awaiting'];
  if (awaiting !== undefined && !isCaseNo(awaiting)) return undefined;

  return {
    runId: raw['runId'],
    phase: raw['phase'],
    ...(awaiting === undefined ? {} : { awaiting }),
    cases,
  };
}
