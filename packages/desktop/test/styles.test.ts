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
  // 整形で折り返された値も 1 行で比べる（`linear-gradient(\n  to top right` など）。
  return bodies
    .join('\n')
    .replace(/\(\s+/g, '(')
    .replace(/[ \t]*\n[ \t]+(?=[^-\s])/g, ' ');
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

/**
 * **キートップは、デザイン案の線画のキーキャップにする**（2026-10-22・持ち主の指示）。
 *
 * 天面を枠の内側に置き、左右と手前の側面に 45° の斜線、四隅を面取りの線で結ぶ。
 * 押すと天面が沈む。色はキーの名前（`--key-*`）だけを使い、明暗はそこで切り替える。
 */
describe('styles.css — キーキャップ', () => {
  it('側面は右上がりの斜線で、四隅に面取りの線が入る', async () => {
    const cap = rulesOf(await readCss(), '.key-binding');
    expect(cap).toContain('repeating-linear-gradient(135deg, var(--key-hatch)');
    for (const corner of ['to top right', 'to top left']) {
      expect(cap).toContain(`linear-gradient(${corner}`);
    }
    expect(cap).toContain('border: 1px solid var(--key-edge)');
  });

  it('天面は枠の内側に置き、押すと沈む', async () => {
    const css = await readCss();
    const face = rulesOf(css, '.key-binding::before');
    expect(face).toContain('background: var(--key-face)');
    expect(face).toContain('border: 1px solid var(--key-face-line)');
    expect(rulesOf(css, '.key-action:active:not(:disabled) .key-binding')).toContain('--kc-top');
  });

  /** 合格（`d`）だけが緑のキー。**押せないときは光らせない**（DESIGN.md「判定の札」）。 */
  it('合格のキーだけ、緑の天面にする', async () => {
    const d = rulesOf(await readCss(), ".key-action[data-key='d']:not(:disabled) .key-binding");
    expect(d).toContain('--key-face: var(--accent)');
  });

  /** Space は札いっぱいの横長。キーの下に説明を置く。 */
  it('Space は札の幅いっぱいに伸ばす', async () => {
    const css = await readCss();
    expect(rulesOf(css, ".key-action[data-key=' ']")).toContain('flex-direction: column');
    expect(rulesOf(css, ".key-action[data-key=' '] .key-binding")).toContain('width: 100%');
  });

  it('キーの色は、ダークでデザイン案の値になる', async () => {
    const css = await readCss();
    const dark = rulesOf(css, ":root[data-appearance='dark']");
    for (const value of ['#7c8b87', '#4a5754', '#262e2c', '#9aa8a4']) {
      expect(dark).toContain(value);
    }
  });
});
