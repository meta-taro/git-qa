// ブラウザでも読める入り口。**Node 専用のもの（ファイル IO）を巻き込まない。**
//
// `@git-qa/core` の入口は TSV の読み込みと run.json の書き出しを含んでおり、
// `node:fs` に依存する。webview 側から使うとバンドルできない（実際にビルドが落ちた）。
// 映像の切り出しはどちらの実行環境でも要るので、ここから出す。
export { createAnnexBSplitter } from './annexb.js';
export type { AccessUnit, AnnexBSplitter } from './annexb.js';
