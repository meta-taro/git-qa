import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declaredAssets, missingAssets } from './assets.js';
import type { AssetConfig } from './assets.js';

/**
 * 配布物が参照しているものが、本当に在るかを数える（§23）。
 *
 * **普段のゲート（`pnpm verify`）には入れない。**建てる道具（`xcrun swiftc` / `cargo`）が
 * 無い環境でも開発は進められるようにしてあり、そこで落とすと開発が止まる。
 * **配る直前に数える** —— §23 の狙いは「配ったあとで初めて壊れる」を止めることなので。
 *
 * **ここは配線なので検査していない。**判断のある所は `assets.ts` にあり、そちらは検査してある。
 */
const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = resolve(here, '..', 'src-tauri');

const config = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8')) as AssetConfig;
const declared = declaredAssets(config);
const missing = missingAssets(declared, (path) => existsSync(join(tauriDir, path)));

if (missing.length === 0) {
  console.log(`[git-qa] 配布物が参照している ${String(declared.length)} 個、すべて在る`);
  process.exit(0);
}

// **黙って通さない。**通すと、配布した先で初めて壊れる。
console.error('[git-qa] 参照されているのに存在しない:');
for (const path of missing) console.error(`  - ${path}`);
console.error(
  '\n建てる手順が失敗している（`pnpm --filter @git-qa/desktop bundle:host`）。' +
    '\n失敗しても先へ進む作りなので、ここで数えないと配布物に入らないまま出る。',
);
process.exit(1);
