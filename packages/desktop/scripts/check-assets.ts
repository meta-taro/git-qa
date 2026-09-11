import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declaredAssets, mergeAssetConfig, missingAssets } from './assets.js';
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

const read = (name: string): AssetConfig | undefined => {
  const path = join(tauriDir, name);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as AssetConfig) : undefined;
};

/**
 * **いま建てている OS の宣言で数える**（2026-09-11）。
 *
 * `git-qa-ocr` / `git-qa-input` / `git-qa-record` は **macOS 専用**で、
 * Windows では建てられない。無条件に数えると、**Windows 版は建つ前にここで止まる。**
 * Tauri も `tauri.<OS>.conf.json` を同じように重ねるので、数え方を揃えておく。
 */
const PLATFORM_CONFIG: Readonly<Record<string, string>> = {
  darwin: 'tauri.macos.conf.json',
  win32: 'tauri.windows.conf.json',
  linux: 'tauri.linux.conf.json',
};

const base = read('tauri.conf.json');
if (base === undefined) throw new Error('tauri.conf.json が無い');

const forPlatform = PLATFORM_CONFIG[process.platform];
const config = mergeAssetConfig(base, forPlatform === undefined ? undefined : read(forPlatform));
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
