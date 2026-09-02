// 画面（webview）と実行器（Node）の共通の形。**ブラウザでも読める。**
// Node 専用のもの（ファイル IO）を巻き込まない（`./live` と同じ理由）。
export { parseHumanInput, parseSessionState } from './protocol.js';
export type { HumanInput, SessionCase, SessionPhase, SessionState } from './protocol.js';
// 結果の語彙は run.json と同じものを使う。画面側で別の語を作らない。
export { AI_RESULTS, CASE_RESULTS, HUMAN_RESULTS } from '../run/types.js';
export type { AiResult, CaseResult, HumanResult } from '../run/types.js';
