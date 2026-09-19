import { describe, expect, it } from 'vitest';

import { listElementNames } from '../src/adb.js';

/**
 * **名前で押せるのに、どんな名前が在るか知る口が無かった**（2026-09-19・MCP 拡充）。
 *
 * `element_tap` は名前で押せる。けれど AI は**画面の文字を読んで名前を推し量る**しかなく、
 * 外れると「押したのに何も起きない」になる（`missingElementMessage` が出る）。
 *
 * **契約は 1 つ。列挙したものは、そのまま `element_tap` に渡せる。**
 * だから `findElementCenter` が当てにいく属性（`resource-id` / `text` / `content-desc`）と
 * **同じものだけ**を並べる。
 */
describe('listElementNames', () => {
  const node = (attrs: Record<string, string>): string =>
    `<node ${Object.entries(attrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ')} />`;

  it('押せる名前を並べる（text / content-desc / resource-id）', () => {
    const xml = [
      node({ text: '保存', bounds: '[0,0][100,50]' }),
      node({ 'content-desc': '戻る', bounds: '[0,60][100,110]' }),
      node({ 'resource-id': 'com.example:id/ok', bounds: '[0,120][100,170]' }),
    ].join('\n');

    expect(listElementNames(xml)).toEqual(['保存', '戻る', 'com.example:id/ok']);
  });

  it('同じ名前は 1 つにする（2 つ並べても、押せるのは 1 つ目だけ）', () => {
    const xml = [
      node({ text: '削除', bounds: '[0,0][10,10]' }),
      node({ text: '削除', bounds: '[0,20][10,30]' }),
    ].join('\n');

    expect(listElementNames(xml)).toEqual(['削除']);
  });

  it('場所が取れないものは並べない（列挙できても押せないなら、嘘になる）', () => {
    const xml = node({ text: '幽霊', bounds: '' });

    expect(listElementNames(xml)).toEqual([]);
  });

  it('空の属性は並べない（画面に無数にある）', () => {
    const xml = node({ text: '', 'content-desc': '', bounds: '[0,0][10,10]' });

    expect(listElementNames(xml)).toEqual([]);
  });

  it('XML の実体参照は戻す（シートの文字と突き合わせられる形にする）', () => {
    const xml = node({ text: 'A &amp; B', bounds: '[0,0][10,10]' });

    expect(listElementNames(xml)).toEqual(['A & B']);
  });
});
