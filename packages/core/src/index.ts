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
  HumanResult,
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
export { RUN_SCHEMA, validateRun } from './run/validate.js';
export type { ValidationResult } from './run/validate.js';

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
