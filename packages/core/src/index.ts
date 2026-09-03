export { TsvParseError } from './tsv/errors.js';
export { parseTestSpecTsv, readTestSpecTsv } from './tsv/parse.js';
export type { TestSpecSheet, TsvColumn, TsvColumnType, TsvDirective, TsvRow } from './tsv/types.js';

export { AI_RESULTS, CASE_RESULTS, HUMAN_RESULTS, RUN_SCHEMA_VERSION } from './run/types.js';
export type {
  Actor,
  AiResult,
  CaseRecording,
  CaseResult,
  Finding,
  HumanAction,
  HumanResult,
  Point,
  Run,
  RunCase,
  RunMode,
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
export type { AccessUnit, AnnexBSplitter } from './live/annexb.js';

export { AdapterError } from './adapter/errors.js';
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
