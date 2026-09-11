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
  /**
   * **2026-09-07、方針を変えた。**
   *
   * > した矢印おしても、したまでいかないね。
   *
   * それまでは「走り終わったケースの中だけ」を行き来していた。まだ走っていない
   * ケースには判定を置けないので、そこへ行かせない、という考えだった。
   *
   * **見るのと置くのは別。**キーの説明も「次のケースを見る」と書いてある。
   * 先に何が来るかを見るのは、人の当たり前の動き。**見るのは全部許す。**
   * 置けないケースへ置こうとしたときは、そこで理由を出す（`whyCannotPlace`）。
   */
  it('走っていないケースも含めて、前後に動く', () => {
    expect(nextCursor(cases(3), 2, 3, 1)).toBe(3);
    expect(nextCursor(cases(3), 2, 3, -1)).toBe(1);
    expect(nextCursor(cases(3), 3, 3, 1)).toBe(4);
    expect(nextCursor(cases(3), 4, 3, 1)).toBe(5);
  });

  it('先頭より前・末尾より後ろへは行かない', () => {
    expect(nextCursor(cases(3), 1, 3, -1)).toBe(1);
    expect(nextCursor(cases(3), 5, 3, 1)).toBe(5);
  });

  it('カーソルが無ければ、打鍵待ちのケースから動く', () => {
    expect(nextCursor(cases(3), undefined, 3, -1)).toBe(2);
    expect(nextCursor(cases(3), undefined, 3, 1)).toBe(4);
  });

  it('ケースが 1 つも無ければ動かない', () => {
    expect(nextCursor([], undefined, 1, 1)).toBeUndefined();
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

/**
 * **鑑賞を止める**（2026-09-11・人の指示）。
 *
 * 止めるのは判定ではない。**まだ走っていないケースを見ていても、止められる。**
 * 止めたいときに止まらないのが、いちばん困る。
 */
describe('humanInputFor — 止める', () => {
  it('止める指示になる', () => {
    expect(humanInputFor({ kind: 'stop' }, 3)).toEqual({ kind: 'stop', caseNo: 3 });
  });

  /** 宛先が無ければ送らない（ほかと同じ）。 */
  it('どのケースを見ているか分からなければ、送らない', () => {
    expect(humanInputFor({ kind: 'stop' }, undefined)).toBeUndefined();
  });
});
