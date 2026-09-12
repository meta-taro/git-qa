import { dirname, isAbsolute, join, relative } from 'node:path';

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
 * **印が無ければ、今までどおり**（打った場所の `runs/`）。既にある使い方を壊さない。
 * 印を置くかどうかは人が決める —— **勝手に人のフォルダへファイルを作らない。**
 */

/** ここが 1 本の試験だ、という印。 */
export const WORKSPACE_FILE = 'git-qa.json';

/**
 * **際限なく遡らない。**
 *
 * 家の一番上まで登ると、**別の試験の印を拾う。**シートを `docs/` や
 * `docs/test-specs/` に置く人が居るので、そのぶんは見る。
 */
const MAX_UP = 4;

/**
 * シートの場所から、その試験のワークスペースを探す。**無ければ `undefined`。**
 *
 * **いちばん近い印が勝つ**（試験の中に試験を置いた人が居ても、近い方）。
 */
export function findWorkspace(
  sheetPath: string,
  exists: (path: string) => boolean,
): string | undefined {
  let dir = dirname(sheetPath);
  for (let up = 0; up <= MAX_UP; up += 1) {
    if (exists(join(dir, WORKSPACE_FILE))) return dir;
    const parent = dirname(dir);
    // 根まで来た。これ以上は上が無い。
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** 証跡の置き場。**シートと同じフォルダの下**に置く（まとめて渡せるように）。 */
export function runsRootIn(workspace: string): string {
  return join(workspace, 'runs');
}

/**
 * **証跡に書く形に直す。**区切りは必ず `/`。
 *
 * `sheet.path` は `run.json` に入って**人の手を渡る。**Windows で走らせた証跡に
 * `docs\\検証.tsv` と書くと、**macOS では開けない。**
 * ケースのフォルダ（`case-001/screen.webp`）と同じで、**区切りは `/` に揃える。**
 *
 * **その機械の事情を、証跡へ持ち込まない。**
 */
export function toEvidencePath(path: string): string {
  return path.split('\\').join('/');
}

/**
 * 証跡に書くシートの場所。**ワークスペースからの相対にする。**
 *
 * いままでは選んだままの絶対パスが入っていた。実物がこれ ——
 *
 * ```
 * "path": "/Users/<個人名>/Documents/GitHub/git-qa/sheets/android-settings-ja.tsv"
 * ```
 *
 * **git で管理するなら、個人名が混ざる**（product-baseline §25）。
 * 相対にすれば、**誰の機械でも同じ形**になる。
 *
 * **外に在るシートは、そのまま。**`../../..` は相対でも持ち運べない。
 */
export function sheetPathIn(workspace: string, sheetPath: string): string {
  const rel = relative(workspace, sheetPath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return sheetPath;
  return toEvidencePath(rel);
}
