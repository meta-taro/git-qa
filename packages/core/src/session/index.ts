// 画面（webview）と実行器（Node）の共通の形。**ブラウザでも読める。**
// Node 専用のもの（ファイル IO）を巻き込まない（`./live` と同じ理由）。
export { parseHumanInput, parseSessionState } from './protocol.js';
export type { HumanInput, SessionCase, SessionPhase, SessionState } from './protocol.js';
// 結果の語彙は run.json と同じものを使う。画面側で別の語を作らない。
export { AI_RESULTS, CASE_RESULTS, HUMAN_RESULTS } from '../run/types.js';
export type { AiResult, CaseResult, HumanResult } from '../run/types.js';

// 置いた人のハンドルの規則。**画面（webview）からも要る**ので、
// Node 専用の口を引き込まないこの入口から出す。
export { HANDLE_RULE, isValidHandle } from '../run/handle.js';
