import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { assertRunnableSheet, parseTestSpecTsv } from '@git-qa/core';

/**
 * 検証シート（TSV）の候補を探す（Issue 011 段階 3）。
 *
 * **人にパスを打たせない。**「検証シートの読み込み方が分からない」が出発点なので、
 * 見つけて並べるところまでやる。
 */

/** 覗かない場所。時間がかかるうえ、こちらのシートではない。 */
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'target',
  'coverage',
  'runs',
  '.next',
  // AI 用の作業場。**雛形しか無い**ので、走らせる相手として並べない。
  '.claude',
  // テストの題材。**パーサに読ませるためのもの**で、実物の端末で通る相手ではない。
  'fixtures',
]);

export interface FindSheetsOptions {
  /** これより深い所は見ない。探すのに時間がかかる。 */
  readonly maxDepth?: number;
}

export async function findSheets(root: string, options: FindSheetsOptions = {}): Promise<string[]> {
  // 既定は 5 段。**同梱の見本（`sheets/…`）はリポジトリの浅い所にある。**
  const maxDepth = options.maxDepth ?? 5;
  const found: string[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // 読めない場所は飛ばす。**探せないこと自体で人の手を止めない。**
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') && entry.name !== '.') {
        if (SKIP.has(entry.name)) continue;
      }
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        await walk(join(dir, entry.name), depth + 1);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.tsv')) found.push(join(dir, entry.name));
    }
  };

  await walk(root, 1);
  return found;
}

/**
 * 走らせられるシートだけを残す。
 *
 * **一覧に出ているのに選ぶと止まるシートは、人を罠にかける。**
 * 2026-09-02 の実行が 5 件とも BLOCKED で終わったのも、選んだものが走るシートではなかったため。
 *
 * 見るのは 2 つだけ — **手順と期待結果の列があるか**、**行が入っているか**。
 * 中身が実物の端末で通るかどうかまでは、ここでは分からない（走らせて初めて分かる）。
 */
export async function keepRunnableSheets(paths: readonly string[]): Promise<string[]> {
  const kept = await Promise.all(
    paths.map(async (path) => {
      try {
        const sheet = parseTestSpecTsv(await readFile(path, 'utf8'));
        if (sheet.rows.length === 0) return undefined;
        assertRunnableSheet(sheet);
        return path;
      } catch {
        // 読めない・形が違うものは黙って外す。**探せないこと自体で人の手を止めない。**
        return undefined;
      }
    }),
  );
  return kept.filter((path): path is string => path !== undefined);
}
