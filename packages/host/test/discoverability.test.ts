import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **名乗りを、どこでも同じ語で言う**（2026-10-13）。
 *
 * 製品名を知らない人が AI や検索に聞いたとき、git-qa が何と説明されるかは、
 * こちらが書いた文で決まる。置き場所ごとに言い方がばらばらだと、どれも採られない。
 *
 * **直した語が、次の誰かの編集で消えないように検査で持つ。**
 * 語を変えるときは、ここと全部の置き場所を同じ commit で直す。
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

/** 英語の名乗りに必ず入れる語。**盛らない** —— できることだけ。 */
const EN_TERMS = ['human-in-the-loop QA', 'test sheet', 'MCP', 'Android', 'iPhone', 'desktop'];

/** 日本語の名乗りに必ず入れる語。日本語の頁にも、検索される英語の語を入れる。 */
const JA_TERMS = ['検証シート', '人が判定', 'human-in-the-loop QA', 'MCP'];

describe('名乗り — 英語', () => {
  it.each([
    ['README.md の冒頭', () => read('README.md').slice(0, 2500)],
    [
      'site/llms.txt の最初の段落',
      () => read('site/llms.txt').split('\n\n').slice(0, 2).join('\n'),
    ],
    [
      '配布ページの JSON-LD',
      () =>
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
          read('site/index.html'),
        )?.[1] ?? '',
    ],
  ])('%s に、決めた語が入っている', (_where, text) => {
    const said = text();
    for (const term of EN_TERMS) expect(said, term).toContain(term);
  });

  it('root の package.json の説明は英語で、決めた語を含む', () => {
    const description = (JSON.parse(read('package.json')) as { description: string }).description;
    expect(description).toContain('human-in-the-loop QA');
  });
});

describe('名乗り — 日本語', () => {
  it.each([
    ['README.ja.md の冒頭', () => read('README.ja.md').slice(0, 2500)],
    [
      '配布ページの title と description',
      () => {
        const html = read('site/index.html');
        const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
        const description = /name="description"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';
        return `${title}\n${description}`;
      },
    ],
  ])('%s に、決めた語が入っている', (_where, text) => {
    const said = text();
    for (const term of JA_TERMS) expect(said, term).toContain(term);
  });
});

describe('名乗り — 配布ページの JSON-LD', () => {
  it('JSON として読め、名前と置き場所を持つ', () => {
    const raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
      read('site/index.html'),
    )?.[1];
    expect(raw).toBeDefined();
    const said = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    expect(said['name']).toBe('git-qa');
    expect(said['url']).toBe('https://meta-taro.github.io/git-qa/');
  });
});
