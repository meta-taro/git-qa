import { describe, expect, it } from 'vitest';

import { listElementsScript, parseElementNames } from '../src/find.js';

/**
 * **名前で押せるのに、どんな名前が在るか知る口が無かった**（2026-09-19・MCP 拡充）。
 *
 * **契約は 1 つ。列挙したものは、そのまま `element_tap` に渡せる。**
 * だから `findElementScript` が当てにいくもの（名乗り・読める文字）と
 * **同じ集め方**にしてある。
 */
describe('listElementsScript', () => {
  it('探すときと同じ集め方をする（見えているものだけ）', () => {
    const script = listElementsScript();

    expect(script).toContain('getBoundingClientRect');
    expect(script).toContain('aria-label');
    // 隠れているものを並べない（押しても何も起きないのに、押したことになる）。
    expect(script).toContain('visibility');
  });

  it('数に上限を持つ（画面 1 枚で数千返すと、AI が読めない）', () => {
    expect(listElementsScript()).toMatch(/slice\(0,\s*\d+\)/);
  });
});

describe('parseElementNames', () => {
  it('文字の並びとして読む', () => {
    expect(parseElementNames(['保存', 'キャンセル'])).toEqual(['保存', 'キャンセル']);
  });

  it('同じ名前は 1 つにする', () => {
    expect(parseElementNames(['保存', '保存'])).toEqual(['保存']);
  });

  it('空や文字でないものは落とす（当て推量で押させない）', () => {
    expect(parseElementNames(['保存', '', '  ', 3, null, undefined])).toEqual(['保存']);
  });

  it('読めない返りは空（「無い」と「読めない」を混ぜないのは呼ぶ側）', () => {
    expect(parseElementNames(undefined)).toEqual([]);
    expect(parseElementNames('保存')).toEqual([]);
  });
});
