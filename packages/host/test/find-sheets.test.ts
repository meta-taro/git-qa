import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findSheets } from '../src/find-sheets.js';

/**
 * 検証シートの候補を探す（Issue 011 段階 3）。
 *
 * **人にパスを打たせない。**「検証シートの読み込み方が分からない」が出発点なので、
 * 見つけて並べるところまでやる。
 */

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'git-qa-sheets-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const put = async (path: string, body = 'x'): Promise<void> => {
  const full = join(root, path);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, body, 'utf8');
};

describe('findSheets', () => {
  it('TSV を見つける', async () => {
    await put('docs/a.tsv');
    await put('docs/deep/b.tsv');

    const found = await findSheets(root);

    expect(found.map((p) => p.replace(root, ''))).toEqual(['/docs/a.tsv', '/docs/deep/b.tsv']);
  });

  it('TSV 以外は拾わない', async () => {
    await put('docs/a.md');
    await put('docs/b.tsv');

    expect(await findSheets(root)).toHaveLength(1);
  });

  it('node_modules や .git は覗かない（時間がかかるうえ、こちらのシートではない）', async () => {
    await put('node_modules/pkg/a.tsv');
    await put('.git/b.tsv');
    await put('dist/c.tsv');
    await put('docs/d.tsv');

    expect(await findSheets(root)).toHaveLength(1);
  });

  it('深すぎる所は見ない（探すのに時間がかかる）', async () => {
    await put('a/b/c/d/e/deep.tsv');
    await put('a/shallow.tsv');

    const found = await findSheets(root, { maxDepth: 3 });

    expect(found.map((p) => p.replace(root, ''))).toEqual(['/a/shallow.tsv']);
  });

  it('読めない場所でも落ちない（空を返す）', async () => {
    await expect(findSheets(join(root, '無い場所'))).resolves.toEqual([]);
  });
});
