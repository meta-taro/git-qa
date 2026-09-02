import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 検証シート（TSV）の候補を探す（Issue 011 段階 3）。
 *
 * **人にパスを打たせない。**「検証シートの読み込み方が分からない」が出発点なので、
 * 見つけて並べるところまでやる。
 */

/** 覗かない場所。時間がかかるうえ、こちらのシートではない。 */
const SKIP = new Set(['node_modules', '.git', 'dist', 'target', 'coverage', 'runs', '.next']);

export interface FindSheetsOptions {
  /** これより深い所は見ない。探すのに時間がかかる。 */
  readonly maxDepth?: number;
}

export async function findSheets(root: string, options: FindSheetsOptions = {}): Promise<string[]> {
  // 既定は 5 段。**同梱の見本（packages/core/test/fixtures/…）が 5 段目にある。**
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
