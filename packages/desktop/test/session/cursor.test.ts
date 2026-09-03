import { describe, expect, it } from 'vitest';
import type { SessionCase } from '@git-qa/core/session';

import { humanInputFor, nextCursor } from '../../src/session/cursor.js';

/**
 * 「いま見ているケース」を動かす所と、打鍵をどのケースへ送るか。
 *
 * **ここが今まで `main.ts` に埋まっていて、検査できていなかった。**
 * 押した判定が別のケースに付くのが一番まずいので、境界を検査で固める。
 */

const cases = (ran: number): SessionCase[] =>
  [1, 2, 3, 4, 5].map((no) => ({
    no,
    title: `ケース ${String(no)}`,
    ...(no <= ran ? { aiResult: 'PASS' as const } : {}),
  }));

describe('nextCursor', () => {
  it('走り終わったケースの中で前後に動く', () => {
    expect(nextCursor(cases(3), 2, 3, 1)).toBe(3);
    expect(nextCursor(cases(3), 2, 3, -1)).toBe(1);
  });

  it('**まだ走っていないケースへは行けない**（見て判断する材料が無い）', () => {
    expect(nextCursor(cases(3), 3, 3, 1)).toBe(3);
  });

  it('先頭より前へは行かない', () => {
    expect(nextCursor(cases(3), 1, 3, -1)).toBe(1);
  });

  it('カーソルが無ければ、打鍵待ちのケースから動く', () => {
    expect(nextCursor(cases(3), undefined, 3, -1)).toBe(2);
  });

  it('走ったケースが 1 つも無ければ動かない', () => {
    expect(nextCursor(cases(0), undefined, 1, 1)).toBeUndefined();
  });
});

describe('humanInputFor', () => {
  it('置かずに次へ', () => {
    expect(humanInputFor({ kind: 'advance' }, 3)).toEqual({ kind: 'advance', caseNo: 3 });
  });

  it('判定を置く', () => {
    expect(humanInputFor({ kind: 'verdict', humanResult: 'VERIFIED' }, 2)).toEqual({
      kind: 'verdict',
      caseNo: 2,
      humanResult: 'VERIFIED',
    });
  });

  it('見ているケースが無ければ送らない', () => {
    expect(humanInputFor({ kind: 'advance' }, undefined)).toBeUndefined();
  });

  it('移動の指示は打鍵として送らない（画面の中の話なので）', () => {
    expect(humanInputFor({ kind: 'prev' }, 2)).toBeUndefined();
    expect(humanInputFor({ kind: 'next' }, 2)).toBeUndefined();
  });
});
