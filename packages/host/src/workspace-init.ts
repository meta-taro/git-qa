import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { WORKSPACE_FILE } from '@git-qa/core';

/**
 * **試験 1 本ぶんの家を作る**（2026-09-12・人の指示）。
 *
 * > 試験 tsv 画像動画がひとつのワークスペースにまとまっているみたいな。
 * > そっちの方が試験単位の git 管理も便利です
 *
 * ```
 * <ここ>/
 *   git-qa.json     ← この印を置く
 *   <検証シート>.tsv  ← 人が置く
 *   runs/           ← 走らせると出来る（証跡・画面・動画）
 * ```
 *
 * **人のフォルダへ勝手にファイルを作らない。**作るのは、人が作れと言ったときだけ。
 * **既にある印は上書きしない** —— 中に書いた設定を黙って消さない。
 */

/** ワークスペースの印の中身。**これ自体が設定の置き場**になる（いまは名前だけ）。 */
export interface WorkspaceMarker {
  readonly schemaVersion: 'git-qa/workspace/v1';
  readonly title: string;
}

export async function initWorkspace(dir: string, title?: string): Promise<string> {
  const path = join(resolve(dir), WORKSPACE_FILE);

  const marker: WorkspaceMarker = {
    schemaVersion: 'git-qa/workspace/v1',
    title: title ?? basename(resolve(dir)),
  };

  await mkdir(resolve(dir), { recursive: true });
  try {
    // `wx` = 既にあるなら作らない。**確かめてから書く**では、その間に置かれたものを消す。
    await writeFile(path, `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`ここは既にワークスペースになっている: ${path}`);
    }
    throw error;
  }
  return path;
}
