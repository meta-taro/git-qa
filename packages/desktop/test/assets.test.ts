import { describe, expect, it } from 'vitest';

import { declaredAssets, mergeAssetConfig, missingAssets } from '../scripts/assets.js';

/**
 * **参照されているのに存在しないアセットを見つける**（product-baseline §23）。
 *
 * > 参照だけ足してアップロードを忘れると、ビルドもテストも通ったまま、実行時にだけ壊れる。
 * > CI で「参照されているのに存在しないアセット」を検出する仕組みを入れる。
 *
 * git-qa では、その仕組みが無かった（2026-09-11 に自分で洗って見つけた）。
 * **`tauri.conf.json` が 3 つの resources を参照しているのに、そのうち 2 つを建てる
 * script は失敗を飲み込む**（`|| echo`）。建てられなくても `pnpm build` は通る。
 */
const CONFIG = {
  bundle: {
    resources: ['resources/host-bundle.mjs', 'resources/git-qa-ocr'],
    icon: ['icons/32x32.png', 'icons/icon.icns'],
  },
};

describe('declaredAssets', () => {
  it('resources と icon の両方を集める', () => {
    expect(declaredAssets(CONFIG)).toEqual([
      'resources/host-bundle.mjs',
      'resources/git-qa-ocr',
      'icons/32x32.png',
      'icons/icon.icns',
    ]);
  });

  /** **書いていない形を、当て推量で埋めない。** */
  it('どちらも無ければ空', () => {
    expect(declaredAssets({})).toEqual([]);
    expect(declaredAssets({ bundle: {} })).toEqual([]);
  });

  it('形がおかしいものは数えない（文字列でないもの）', () => {
    expect(declaredAssets({ bundle: { resources: ['a', 1, null] } })).toEqual(['a']);
  });
});

describe('missingAssets', () => {
  it('無いものだけを返す', () => {
    const missing = missingAssets(['a', 'b', 'c'], (path) => path !== 'b');

    expect(missing).toEqual(['b']);
  });

  it('全部あれば空', () => {
    expect(missingAssets(['a'], () => true)).toEqual([]);
  });
});

/**
 * **OS ごとに、配るものが違う**（2026-09-11）。
 *
 * `git-qa-ocr`（Vision）・`git-qa-input`（CoreGraphics）・`git-qa-record`
 * （ScreenCaptureKit）は **macOS 専用**で、Windows では建てられない。
 * ところが `tauri.conf.json` は 3 つとも**無条件で参照していた。**
 *
 * このまま Windows 版を建てると、**`pnpm check:assets` が落ちて、建つ前に止まる。**
 * Windows で動かすのはウェブ検証と Android 検証で、**そもそもこの 3 つは要らない。**
 *
 * Tauri は `tauri.<OS>.conf.json` を自動で重ねる。**配列は置き換わる。**
 */
describe('mergeAssetConfig', () => {
  const base = { bundle: { resources: ['resources/host-bundle.mjs'], icon: ['icons/icon.ico'] } };

  it('その OS の宣言があれば、そちらで置き換える', () => {
    const merged = mergeAssetConfig(base, {
      bundle: { resources: ['resources/host-bundle.mjs', 'resources/git-qa-ocr'] },
    });

    expect(declaredAssets(merged)).toEqual([
      'resources/host-bundle.mjs',
      'resources/git-qa-ocr',
      'icons/icon.ico',
    ]);
  });

  /** **その OS の宣言が無ければ、元のまま。**無いことを「空」と取り違えない。 */
  it('宣言が無ければ、元のまま', () => {
    expect(declaredAssets(mergeAssetConfig(base, undefined))).toEqual([
      'resources/host-bundle.mjs',
      'icons/icon.ico',
    ]);
  });

  /** 触れていない側は残す（`resources` だけ書いた OS の設定で、アイコンを消さない）。 */
  it('書かれていない方は消さない', () => {
    const merged = mergeAssetConfig(base, { bundle: { resources: ['a'] } });

    expect(declaredAssets(merged)).toContain('icons/icon.ico');
  });
});
