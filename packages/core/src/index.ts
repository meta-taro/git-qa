export { TsvParseError } from './tsv/errors.js';
export { parseTestSpecTsv, readTestSpecTsv } from './tsv/parse.js';
export type { TestSpecSheet, TsvColumn, TsvColumnType, TsvDirective, TsvRow } from './tsv/types.js';

export { AI_RESULTS, CASE_RESULTS, HUMAN_RESULTS, RUN_SCHEMA_VERSION } from './run/types.js';
export type {
  Actor,
  AiResult,
  BrowserProfileKind,
  CaseRecording,
  CaseResult,
  Finding,
  HumanAction,
  HumanInputCounts,
  HumanResult,
  Point,
  Run,
  RunCase,
  RunMode,
  Runner,
  RunStep,
  SheetRef,
  Target,
  TargetBuild,
} from './run/types.js';
export { resolveCaseResult } from './run/result.js';
export type { ResultInput } from './run/result.js';
export { caseDir, caseDirName, runDir, runJsonPath } from './run/layout.js';
export { CASE_NO_COLUMN, CASE_TITLE_COLUMN, executeRun, toCaseSubjects } from './run/execute.js';
export type {
  CaseContext,
  CaseSubject,
  CaseVerdict,
  ExecuteRunOptions,
  HumanVerdict,
} from './run/execute.js';
export {
  EXPECTATION_COLUMN,
  STEPS_COLUMN,
  assertRunnableSheet,
  createSheetCaseRunner,
} from './run/case-runner.js';
export type { SheetCaseRunnerOptions } from './run/case-runner.js';
export { HANDLE_RULE, isValidHandle } from './run/handle.js';
export { judgeExpectation, planExpectation, planSteps } from './run/steps.js';
export type {
  ExpectationCheck,
  ExpectationContains,
  ExpectationHold,
  PlannedAction,
  PlannedHold,
  PlannedStep,
} from './run/steps.js';
export { RUN_SCHEMA, validateRun } from './run/validate.js';
export { writeRunJson } from './run/write.js';
export type { ValidationResult } from './run/validate.js';

// 生 H.264 の切り出しは UI 固有ではない。映像を出す側（アダプタ）も、
// 描く側（デスクトップ）も同じ切り方を使う。
export { createAnnexBSplitter } from './live/annexb.js';
export { createFrameSplitter, encodeFrame } from './live/frames.js';
export type { FrameSplitter, FrameSplitterOptions } from './live/frames.js';
export type { AccessUnit, AnnexBSplitter } from './live/annexb.js';

export { AdapterError, humanMessage } from './adapter/errors.js';
export type {
  Action,
  AdapterCapabilities,
  LiveView,
  LiveViewTransport,
  Observation,
  ObservationKind,
  PointerRef,
  RecordingControl,
  Screenshot,
  TargetAdapter,
  TargetSession,
} from './adapter/types.js';
// Fake は本番の実行では使わないが、下流のパッケージ（実行器・デスクトップ）が
// 対象なしでテストを書くために要る。だから輸出する。
export { createFakeAdapter } from './adapter/fake.js';
export type { FakeAdapter, FakeAdapterOptions } from './adapter/fake.js';

// 打鍵の割り当ての正本（`./session` からも出している）。
export { VERDICT_KEYS, verdictKeyHint } from './session/verdict-keys.js';
export type { Pointing } from './session/protocol.js';

// 証跡が何に対して置かれたのかを確かめる（外部レビュー #1）。
export { compareSheet, renderSheetCheck, sheetDigest } from './run/sheet-check.js';
export type { CheckedRun, SheetCheck } from './run/sheet-check.js';

// 判定を置く時点の画面（2026-09-11）。
export { captureCaseShot } from './run/case-shot.js';
export type { CaptureCaseShotOptions } from './run/case-shot.js';

// 撮った絵の名乗りと中身を結ぶ（2026-09-11）。
export { mimeTypeOf } from './adapter/shot-format.js';

export { webpCommand } from './adapter/to-webp.js';
export type { ImageTools, ToolCommand } from './adapter/to-webp.js';
export { saveAsWebp } from './run/shot-webp.js';

// 途中経過の証跡（外部レビュー #2）。
export { saveRunProgress } from './run/save-progress.js';
export { webmCommand } from './adapter/to-webm.js';
export { saveAsWebm } from './run/video-webm.js';
export type { SaveAsWebmOptions, SavedVideo } from './run/video-webm.js';
export { compareFingerprint } from './run/target-check.js';
export {
  WORKSPACE_FILE,
  findWorkspace,
  runsRootIn,
  sheetPathIn,
  toEvidencePath,
} from './run/workspace.js';
export type { TargetCheck } from './run/target-check.js';

// シートが宣言する「何を検証したか」と「何処を見るか」（外部レビュー #22）。
export {
  DESTINATION_KEY,
  SUBJECT_KEY,
  duplicateTargetMessage,
  sheetDestination,
  sheetSubject,
} from './run/sheet-target.js';

// 流した日から決まる日付の言い方（外部レビュー #29）。
export { DATE_FORMAT_KEY, expandDates, formatDate } from './run/dates.js';
export { WAIT_KEY, sheetWaitMs } from './run/wait.js';
export type { ResolvedDate } from './run/dates.js';
// 1 枚ずつの絵を動画にする（外部レビュー #31）。
export { framesToWebmCommand } from './adapter/frames-to-webm.js';
