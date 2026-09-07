import { describe, expect, it } from 'vitest';

import type { SessionCase } from '@git-qa/core/session';

import { whyCannotPlace } from '../../src/session/cursor.js';

/**
 * **2026-09-07、置き直しを調べていて見つけた。**
 *
 * 打鍵を送った瞬間に、置いた記号を画面へ光らせていた。
 * **受け取られたかどうかは見ていない。**
 *
 * 実行器は「まだ走っていないケース」への判定を捨てる（見て判断する材料が無いので正しい）。
 * ところが画面は光る。**置いていないのに、置いた合図が出る。**
 * 黙って捨てるより悪い —— 人は置いたと思って次へ行く。
 */
const cases: SessionCase[] = [
  { no: 1, title: '済んだケース', aiResult: 'PASS' },
  { no: 2, title: 'いま待っているケース', aiResult: 'FAIL' },
  { no: 3, title: 'まだ走っていないケース' },
];

describe('whyCannotPlace', () => {
  it('走り終わったケースには置ける', () => {
    expect(whyCannotPlace(cases, 1, 'waiting')).toBeUndefined();
    expect(whyCannotPlace(cases, 2, 'waiting')).toBeUndefined();
  });

  it('まだ走っていないケースには置けない（見て判断する材料が無い）', () => {
    expect(whyCannotPlace(cases, 3, 'waiting')).toContain('まだ');
  });

  it('終わった検証には置けない（証跡はもう書かれている）', () => {
    expect(whyCannotPlace(cases, 1, 'finished')).toContain('終わ');
  });

  it('知らないケース番号には置けない', () => {
    expect(whyCannotPlace(cases, 99, 'waiting')).toBeDefined();
    expect(whyCannotPlace(cases, undefined, 'waiting')).toBeDefined();
  });
});
