import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findSheets, keepRunnableSheets } from '../src/find-sheets.js';

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

/**
 * **走らせられないものを並べない。**
 *
 * 一覧に出ているのに選ぶと止まるシートは、人を罠にかける。実際に 2026-09-02 の実行は
 * 5 件とも BLOCKED で終わり、原因は選んだシートが走るものではなかったことだった。
 * ここで見るのは 2 つだけ — **手順と期待結果の列があるか**、**行が入っているか**。
 */
describe('走らせられるシートだけを残す', () => {
  const write = async (name: string, body: string): Promise<string> => {
    const path = join(root, name);
    await writeFile(path, body, 'utf8');
    return path;
  };

  const RUNNABLE = [
    '#! md-business:test-spec-tsv/v1',
    'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
    '1\tアプリが起動する\tアプリを起動する\t「Settings」と表示される',
    '',
  ].join('\n');

  it('手順と期待結果がそろっていれば残す', async () => {
    const path = await write('run-me.tsv', RUNNABLE);

    await expect(keepRunnableSheets([path])).resolves.toEqual([path]);
  });

  it('列の違うシート（改善要望）は外す', async () => {
    const path = await write(
      'feedback.tsv',
      ['No.:number!\t起票日:date!\t種別', '1\t2026-01-01\t困った', ''].join('\n'),
    );

    await expect(keepRunnableSheets([path])).resolves.toEqual([]);
  });

  it('中身の無い雛形は外す', async () => {
    const path = await write('template.tsv', RUNNABLE.split('\n').slice(0, 2).join('\n') + '\n');

    await expect(keepRunnableSheets([path])).resolves.toEqual([]);
  });

  it('読めないものは、黙って外す（探せないことで手を止めない）', async () => {
    await expect(keepRunnableSheets([join(root, 'nope.tsv')])).resolves.toEqual([]);
  });
});

describe('AI 用の作業場は覗かない', () => {
  it('fixtures の下は探さない（テストの題材で、走らせる相手ではない）', async () => {
    await mkdir(join(root, 'test', 'fixtures'), { recursive: true });
    await writeFile(join(root, 'test', 'fixtures', 'sample.tsv'), 'x', 'utf8');

    await expect(findSheets(root)).resolves.toEqual([]);
  });

  it('.claude の下は探さない（雛形しか無い）', async () => {
    await mkdir(join(root, '.claude', 'templates'), { recursive: true });
    await writeFile(join(root, '.claude', 'templates', 'standard.tsv'), 'x', 'utf8');

    await expect(findSheets(root)).resolves.toEqual([]);
  });
});
