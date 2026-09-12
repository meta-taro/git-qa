import { describe, expect, it } from 'vitest';

import { WORKSPACE_FILE, findWorkspace, runsRootIn, sheetPathIn } from '../../src/run/workspace.js';

/**
 * **試験 1 本を、1 つのフォルダにまとめる**（2026-09-12・人の指示）。
 *
 * > 試験というプロジェクトファイルみたいなイメージでした。試験 tsv 画像動画が
 * > ひとつのワークスペースにまとまっているみたいな。そっちの方が試験単位の
 * > git 管理も便利です
 *
 * ```
 * <ワークスペース>/
 *   git-qa.json          ← ここが 1 本の試験だという印
 *   <検証シート>.tsv
 *   runs/
 *     20260912-090000/
 *       run.json
 *       case-001/screen.webp · screen.webm
 * ```
 *
 * **印が無ければ、今までどおり。**既にある使い方を壊さない。
 */

/** その場所に印があるか、を答える役（検査では嘘をつかせる）。 */
const marked =
  (...dirs: string[]) =>
  (path: string): boolean =>
    dirs.some((d) => path === `${d}/${WORKSPACE_FILE}`);

describe('findWorkspace', () => {
  it('シートと同じ所に印があれば、そこがワークスペース', () => {
    expect(findWorkspace('/w/検証.tsv', marked('/w'))).toBe('/w');
  });

  /** シートを `docs/` に置く人が居る。**印は上にあってよい。** */
  it('上の階にある印も見つける', () => {
    expect(findWorkspace('/w/docs/検証.tsv', marked('/w'))).toBe('/w');
  });

  /** **印が無ければ、ワークスペースではない。**当てずっぽうで根を決めない。 */
  it('印が無ければ、見つからないと言う', () => {
    expect(findWorkspace('/w/docs/検証.tsv', () => false)).toBeUndefined();
  });

  /** **際限なく遡らない。**家の一番上まで登って、別の試験の印を拾わない。 */
  it('遠すぎる印は拾わない', () => {
    expect(findWorkspace('/a/b/c/d/e/f/g/検証.tsv', marked('/a'))).toBeUndefined();
  });

  /** いちばん近い印が勝つ（試験の中に試験を置いた人が居ても、近い方）。 */
  it('近い方の印が勝つ', () => {
    expect(findWorkspace('/w/中/検証.tsv', marked('/w', '/w/中'))).toBe('/w/中');
  });
});

describe('runsRootIn', () => {
  it('証跡はワークスペースの runs/ に置く', () => {
    expect(runsRootIn('/w')).toBe('/w/runs');
  });
});

describe('sheetPathIn', () => {
  /**
   * **証跡に、その機械の事情を書き込まない。**
   *
   * いままで `sheet.path` には選んだままの絶対パスが入っていた。
   * 実物がこれ ——
   *
   * ```
   * "path": "/Users/<個人名>/Documents/GitHub/git-qa/sheets/android-settings-ja.tsv"
   * ```
   *
   * **git で管理するなら、個人名が混ざる**（product-baseline §25）。
   * ワークスペースからの相対にすれば、**誰の機械でも同じ形**になる。
   */
  it('ワークスペースからの相対にする', () => {
    expect(sheetPathIn('/w', '/w/docs/検証.tsv')).toBe('docs/検証.tsv');
  });

  it('ワークスペースの直下ならファイル名だけ', () => {
    expect(sheetPathIn('/w', '/w/検証.tsv')).toBe('検証.tsv');
  });

  /** **外に在るシートは、相対にしない。**`../../..` は相対でも持ち運べない。 */
  it('ワークスペースの外にあるものは、そのまま', () => {
    expect(sheetPathIn('/w', '/other/検証.tsv')).toBe('/other/検証.tsv');
  });
});
