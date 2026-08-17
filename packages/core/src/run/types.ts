/**
 * 動作検証 1 回分（`run.json`）の型。形の正本は `schema/run.schema.json`。
 *
 * ここの union と JSON Schema の enum がずれていないことは、テストで見ている。
 */

/** この形の版。`run.json` の `schemaVersion` に入る。 */
export const RUN_SCHEMA_VERSION = 'git-qa/run/v1';

/**
 * AI が出せる結果。**`VERIFIED` はここに無い。**
 *
 * 「人が名前を置いた」は AI の語彙ではない。実行時に弾くのではなく、値として持てないようにする。
 */
export const AI_RESULTS = ['PASS', 'FAIL', 'BLOCKED', 'SKIP'] as const;
export type AiResult = (typeof AI_RESULTS)[number];

/**
 * 人が出せる結果。**`AUTO_PASS` はここに無い。**
 *
 * `AUTO_PASS` は「誰も見ていない」ことの記録なので、人が付ける値ではない。
 */
export const HUMAN_RESULTS = ['VERIFIED', 'FAIL', 'BLOCKED', 'SKIP'] as const;
export type HumanResult = (typeof HUMAN_RESULTS)[number];

/** 最終結果（decisions.md C1）。`VERIFIED` と `AUTO_PASS` を 1 つの値に潰さない。 */
export const CASE_RESULTS = ['VERIFIED', 'AUTO_PASS', 'FAIL', 'BLOCKED', 'SKIP'] as const;
export type CaseResult = (typeof CASE_RESULTS)[number];

/** manual = 人が全部操作 / assisted = AI が操作し人が見る / auto = AI だけ */
export type RunMode = 'manual' | 'assisted' | 'auto';

export interface Actor {
  /** 個人名・個人メールアドレスは入れない（公開リポジトリ）。 */
  handle: string;
}

export interface SheetRef {
  path: string;
  /** 読んだ時点のシートの中身。実行後にシートが変わったら突き合わせで分かる。 */
  sha256: string;
  title?: string;
  documentNumber?: string;
}

export interface TargetBuild {
  source?: string;
  commit?: string;
  label?: string;
}

export interface Target {
  kind: 'web' | 'android' | 'desktop';
  device?: string;
  osVersion?: string;
  browser?: string;
  build: TargetBuild;
}

/** 動画が無いとき、録画オフだったのか失敗したのかを区別できるようにする（C11）。 */
export type CaseRecording =
  | { state: 'recorded'; file: string; durationMs: number }
  | { state: 'not_requested' }
  | { state: 'failed'; reason: string }
  | { state: 'unsupported'; reason: string };

export interface RunStep {
  index: number;
  at: string;
  label?: string;
}

export interface RunCase {
  /** 検証シートの No. 列。行 ID は md-business 側のものなので持たない（C3）。 */
  no: number;
  title: string;
  startedAt: string;
  finishedAt?: string;
  aiResult?: AiResult;
  humanResult?: HumanResult;
  result: CaseResult;
  verifiedBy?: string;
  verifiedAt?: string;
  steps: RunStep[];
  recording: CaseRecording;
  note?: string;
}

export interface Finding {
  id: string;
  title: string;
  severity: 'low' | 'medium' | 'high';
  foundAt: string;
  caseNo?: number;
  detail?: string;
}

export interface Run {
  schemaVersion: typeof RUN_SCHEMA_VERSION;
  runId: string;
  startedAt: string;
  /** 中断した実行では無い。無いことが「途中で止まった」の記録になる。 */
  finishedAt?: string;
  operator: Actor;
  mode: RunMode;
  sheet: SheetRef;
  target: Target;
  /** 録画するかどうかは実行開始時の設定であって、モードには紐づかない（C11）。 */
  recording: { requested: boolean };
  cases: RunCase[];
  findings: Finding[];
}
