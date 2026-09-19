/**
 * 動作検証 1 回分（`run.json`）の型。形の正本は `schema/run.schema.json`。
 *
 * ここの union と JSON Schema の enum がずれていないことは、テストで見ている。
 */

import type { TargetCheck } from './target-check.js';

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
/**
 * 誰がどこまで関わった実行か。
 *
 * `'watched'` は**鑑賞**（2026-09-11・人の指示）。
 * `assisted` は**人が押すまで次へ行かない**、`auto` は**誰も見ていない**。
 * 鑑賞はどちらでもない —— **人は見ているが、押さなくても進む。**
 * どちらかの名前を借りると、証跡を読んだ人が実際と違うものを思い浮かべる。
 */
export type RunMode = 'manual' | 'assisted' | 'watched' | 'auto';

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

/**
 * `fresh` = 毎回まっさら / `provided` = 検証用に用意されたもの（ログイン済みの可能性がある）
 * / `personal` = **普段使いのブラウザの置き場所にあるもの**（その人の私物）。
 */
export type BrowserProfileKind = 'fresh' | 'provided' | 'personal';

export interface Target {
  /**
   * `ios` は iPhone / iPad（2026-09-19）。
   *
   * **Android と分けてある。**触れ方が違う（押す口が無く、端末側にアプリを入れるには
   * 署名が要る）ので、**証跡を読む人が「Android と同じように操作した」と読まないため。**
   */
  kind: 'web' | 'android' | 'ios' | 'desktop';
  /**
   * 実際に見に行った場所（シートの `行き先`）。
   *
   * **「何を検証したか」（`build.source`）と分ける**（外部レビュー meta-taro/git-qa#22）。
   * シートの `対象` に `owner/repo@branch` を書く運用があり、
   * **URL に書き換えさせると「どのブランチを検証したか」が証跡から消える。**
   */
  destination?: string;
  device?: string;
  osVersion?: string;
  browser?: string;
  /**
   * **どのプロファイルで見たか**（外部レビュー meta-taro/git-qa#35）。
   *
   * まっさら・用意されたもの・**その人の私物**は、同じ結果でも意味が違う。
   * 「その権限の人には見えた」でしかないのか、**私物の環境を触ったのか**が
   * 読む人に分からないと、証跡として弱い。
   *
   * 古い証跡には無いので、任意にしてある。
   */
  profile?: BrowserProfileKind;
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
  /**
   * 流した日から決めた日付（外部レビュー meta-taro/git-qa#29）。
   *
   * シートに「今日から 2 日後」と書かれていたものを、**実際に何日として押したか。**
   * 残さないと、**後から読んだ人が、その実行が何日を押したのか復元できない** ——
   * 落ちた行を追いかけるときに、いちばん要る情報。
   */
  dates?: { said: string; resolved: string }[];
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

/** 判定を出した道具。**名前と版は、片方だけでは意味を持たない。** */
export interface Runner {
  name: string;
  /** 配った版の名乗り（例 `v0.2.0-beta.12`）。**手元で建てたものは `dev` が付く。** */
  version: string;
}

export interface Run {
  schemaVersion: typeof RUN_SCHEMA_VERSION;
  runId: string;
  startedAt: string;
  /** 中断した実行では無い。無いことが「途中で止まった」の記録になる。 */
  finishedAt?: string;
  operator: Actor;
  /**
   * **判定を出した道具**（2026-09-18）。
   *
   * 証跡は「誰が・いつ・何を見て判定したか」を残すのに、
   * **それを出した道具の版だけが残っていなかった。**
   * 版が残らないと、**直っているはずの不具合が直っていない**という話が噛み合わない。
   *
   * 古い証跡には無いので、任意にしてある。
   */
  runner?: Runner;
  mode: RunMode;
  sheet: SheetRef;
  target: Target;
  /**
   * **走行中に相手が入れ替わっていないか**（外部レビュー meta-taro/git-qa#3）。
   *
   * 測る口を持たない相手では `unmeasurable` になる。**無いことにしない。**
   * 古い証跡には無いので、任意にしてある。
   */
  targetCheck?: TargetCheck;
  /** 録画するかどうかは実行開始時の設定であって、モードには紐づかない（C11）。 */
  recording: { requested: boolean };
  cases: RunCase[];
  findings: Finding[];
}
