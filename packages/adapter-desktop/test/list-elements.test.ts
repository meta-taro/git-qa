import { describe, expect, it } from 'vitest';

import { elementNamesOf } from '../src/screen-text.js';

/**
 * **名前で押せるのに、どんな名前が在るか知る口が無かった**（2026-09-19・MCP 拡充）。
 *
 * デスクトップは `observe()` が既に `elements` を持っている（段 1・AX）。
 * **MCP が出していなかっただけ。**
 *
 * **契約は 1 つ。列挙したものは、そのまま `element_tap` に渡せる。**
 * `findInElements` が当てにいくのは**名前**なので、名前だけを並べる。
 */
describe('elementNamesOf', () => {
  const seen = (elements: unknown): { raw: unknown } => ({ raw: { elements } });

  it('名前を並べる', () => {
    const said = elementNamesOf(
      seen([
        { role: 'AXButton', name: '保存', x: 0, y: 0, width: 10, height: 10 },
        { role: 'AXStaticText', name: '保存しました', x: 0, y: 20, width: 80, height: 10 },
      ]),
    );

    expect(said).toEqual(['保存', '保存しました']);
  });

  it('同じ名前は 1 つにする', () => {
    const said = elementNamesOf(
      seen([
        { role: 'AXButton', name: '閉じる' },
        { role: 'AXButton', name: '閉じる' },
      ]),
    );

    expect(said).toEqual(['閉じる']);
  });

  it('名前の無いものは並べない（押せないものを並べない）', () => {
    expect(elementNamesOf(seen([{ role: 'AXGroup', name: '' }, { role: 'AXGroup' }]))).toEqual([]);
  });

  it('段 1 が空でも落ちない（絵からしか読めない相手は普通にある）', () => {
    expect(elementNamesOf(seen([]))).toEqual([]);
    expect(elementNamesOf({ raw: {} })).toEqual([]);
    expect(elementNamesOf({ raw: null })).toEqual([]);
  });
});
