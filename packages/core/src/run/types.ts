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
  /**
   * 読んだ時点のシートの中身。
   *
   * **突き合わせる側は `compareSheet` にある**（`run/sheet-check.ts`）。
   * 2026-09-11 までは書く側しか無く、**型のコメントだけが「分かる」と言っていた**
   * （外部レビュー meta-taro/git-qa#1）。**意図を書くだけにしない。**
   */
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

/**
 * 判定を置く時点の画面（2026-09-11）。
 *
 * 動画（`CaseRecording`）と同じ形にしてある。**無いときに、撮らなかったのか
 * 失敗したのかが読めること**が大事で、そこは静止画でも同じ。
 */
export type CaseScreenshot =
  | { state: 'saved'; file: string }
  | { state: 'not_requested' }
  | { state: 'failed'; reason: string }
  | { state: 'unsupported'; reason: string };

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

/** 端末の画面の位置（画素）。 */
export interface Point {
  x: number;
  y: number;
}

/**
 * 人が自分で端末を触った操作。**AI の足跡（`steps`）とは別に残す。**
 *
 * AI が判断保留にして止まった後、人が触って確かめた過程が読めるようにするため。
 * **無いことにも意味がある**（触らずに見ただけで判定した）。
 *
 * **文字入力の中身は残さない。**検証中の画面には顧客名や電話番号が写る（PRD §10）ので、
 * 打った文字そのものは書かない。「文字を送った」ことと時刻だけを残す。
 */
export interface HumanAction {
  at: string;
  kind: 'tap' | 'swipe' | 'longPress' | 'text';
  from?: Point;
  to?: Point;
}

/**
 * 人が道具へ打った、判定まわりの入力回数。**手数（Issue 008 の主指標）を数えるために要る。**
 *
 * 端末を触った回数は `humanActions` の長さで数えられるが、**判定を置いた打鍵は
 * どこにも残っていなかった。**所要時間で差が出なかったときに、どこで食っているかを
 * 切り分ける材料になる。
 *
 * `verdict` が 2 以上のケースは**置き直したケース**。多いなら、そこは画面が分かりにくい。
 */
export interface HumanInputCounts {
  /** 判定を置いた回数（置き直しを含む）。 */
  verdict: number;
  /** 判定を置かずに次へ送った回数。 */
  advance: number;
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
  /** 人が自分で触った操作。無ければ、人は触っていない。 */
  humanActions?: HumanAction[];
  /** 判定まわりの打鍵回数。無ければ、人はこのケースに何も打っていない。 */
  humanInputs?: HumanInputCounts;
  recording: CaseRecording;
  /**
   * 判定を置く時点の画面。**動画と同じで、無いときは理由が分かる形にする。**
   * 2026-09-11 まで、証跡フォルダには `run.json` しか無かった。
   */
  screenshot?: CaseScreenshot;
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
