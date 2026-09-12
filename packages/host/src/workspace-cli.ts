import { initWorkspace } from './workspace-init.js';
import { fromInvocationDir } from './paths.js';

/**
 * `pnpm ws:init <フォルダ> [名前]` —— **試験 1 本ぶんの家を作る**（2026-09-12）。
 *
 * ```
 * <フォルダ>/
 *   git-qa.json      ← 置く印
 *   <検証シート>.tsv   ← 人が置く
 *   runs/            ← 走らせると出来る（証跡・画面・動画）
 * ```
 *
 * **ここは配線なので検査していない。**判断のある所は `workspace-init.ts` にある。
 */

const [target, title] = process.argv.slice(2);

if (target === undefined) {
  console.error('使い方: pnpm ws:init <フォルダ> [名前]');
  process.exit(2);
}

const path = await initWorkspace(fromInvocationDir(target), title);

console.log(`[git-qa] ワークスペースにした: ${path}`);
console.log('');
console.log('  この下に検証シート（.tsv）を置いてください。');
console.log('  走らせると、証跡・画面・動画が runs/ に積まれます。');
console.log('  **フォルダごと git で管理できます**（試験 1 本 = 1 リポジトリ）。');
