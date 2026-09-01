// テストのための入り口。**本番の実行では読み込まれない。**
// 下流のパッケージ（アダプタ・実行器・デスクトップ）が、対象なしでテストを書くために要る。
export { describeAdapterContract } from './adapter-contract.js';
export { COMMIT, SHA256, validRun } from './fixtures.js';
