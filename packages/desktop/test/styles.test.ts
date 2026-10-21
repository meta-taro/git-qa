import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **実物の画面で崩れていた所**（2026-10-21）。
 *
 * happy-dom は組み版をしないので、DOM のテストでは重なりも見分けの付かなさも見えない。
 * ここでは**崩れの原因になった規則そのもの**を確かめる。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const readCss = (): Promise<string> => readFile(path.resolve(here, '../src/styles.css'), 'utf8');

/**
 * その選択子を含む規則の中身。**まとめて書いた規則**（`a,\nb {`）も拾い、
 * 同じ選択子が何度出てきても全部つなげる。
 */
const rulesOf = (css: string, selector: string): string => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  for (const [, selectors = '', body = ''] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').some((one) => one.trim() === selector)) bodies.push(body);
  }
  return bodies.join('\n');
};

describe('styles.css — 実物で崩れていた所', () => {
  /**
   * 判定の欄は狭い。4 つ横に並べると、`AUTO_PASS` と `FAIL` の見出しが
   * くっついて `AUTO_PASSFAIL` と読めた。**2 つずつ 2 段にする。**
   */
  it('まとめの数は、2 つずつ並べる', async () => {
    const css = await readCss();
    expect(rulesOf(css, '.summary-counts')).toContain('grid-template-columns: repeat(2,');
  });

  /**
   * 選んだシートは地が少し明るくなるだけで、選んでいない札と見分けが付かなかった。
   * **印を付ける。**ただし光らせない —— 準備の画面で光るのは、選んだ端末と「始める」だけ（DESIGN.md）。
   */
  it('選んだシートと続きからには印が付き、光らない', async () => {
    const css = await readCss();
    const mark = rulesOf(css, ".setup-sheet[aria-pressed='true'] .pick-name::after");
    expect(mark).toContain("content: '✓'");
    expect(mark).not.toContain('--accent');

    const chosen = rulesOf(css, ".setup-sheet[aria-pressed='true']");
    expect(chosen).toContain('border-color: var(--text-2)');
    expect(chosen).not.toContain('--accent');
  });

  /**
   * 札に `display` を当てると、`hidden` が負ける（UA の `display: none` より作者の規則が勝つ）。
   * 古い実行を畳んだはずが、実物では全部出ていた。**畳んだ札は、こちらで消す。**
   */
  it('畳んだ続きからの札は出ない', async () => {
    const css = await readCss();
    expect(rulesOf(css, '.setup-resume[hidden]')).toContain('display: none');
  });
});
