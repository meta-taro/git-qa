import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **DESIGN.md に書いていない色を、CSS へ直接書かない**（DESIGN.md「この文書の使われ方」）。
 *
 * 人が気をつける方式は漏れる。`#000` を直書きして、ライトでも真っ黒になった前例がある。
 * 2026-10-20 にダークの配色を取り込んで、CSS に色の値が増えた —— ここで止める。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string): Promise<string> => readFile(path.resolve(here, relative), 'utf8');

const hexes = (text: string): string[] =>
  [...new Set([...text.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase()))].sort();

describe('styles.css の色', () => {
  it('使っている色は、全部 DESIGN.md に在る', async () => {
    const css = await read('../src/styles.css');
    const design = (await read('../../../DESIGN.md')).toLowerCase();

    const missing = hexes(css).filter((hex) => !design.includes(hex));
    expect(missing).toEqual([]);
  });

  /** **ダークの色を、ライトの人に見せない。**人がライトを選んだら、OS の色へ戻る。 */
  it('ダークの配色は、人がライトを選んだときには掛からない', async () => {
    const css = await read('../src/styles.css');

    expect(css).toContain(":root:not([data-appearance='light'])");
    expect(css).toContain(":root[data-appearance='dark']");
  });
});
