import { describe, expect, it } from 'vitest';

import { renderSheetCheck } from '../../src/run/sheet-check.js';

/**
 * 突き合わせた結果を、**人が読んで次に何をすればよいか分かる形**で返す。
 *
 * この 1 週間で 5 回踏んだのと同じ形を、ここで繰り返さないため
 * ——「起きなかったことの理由が、呼び手に返らない」。
 */
const run = {
  runId: '20260908-101500',
  sheet: { path: 'sheets/a.tsv', sha256: 'a'.repeat(64), title: 'ある検証' },
  // **実物の証跡と同じ形**（2026-09-28 に直した）。人が置いた行には humanResult が有る。
  cases: [
    { no: 1, result: 'VERIFIED', humanResult: 'VERIFIED' },
    { no: 2, result: 'AUTO_PASS' },
    { no: 3, result: 'FAIL', humanResult: 'FAIL' },
    // AI が BLOCKED にして、人は置いていない。**数えない。**
    { no: 4, result: 'BLOCKED' },
  ],
};

describe('renderSheetCheck', () => {
  it('同じなら、そう言って終わる', () => {
    const text = renderSheetCheck(run, { kind: 'same', reason: 'シートは同じ（abc）' });

    expect(text).toContain('20260908-101500');
    expect(text).toContain('シートは同じ');
  });

  /**
   * **人が置いた判定の件数を出す。**
   * シートが変わっていたとき、**失われるのは人が見て置いた分**なので、
   * そこが何件あるのかは、読んだ人がいちばん知りたい。
   */
  it('変わっていたら、人が置いた分が何件あるかを出す', () => {
    const text = renderSheetCheck(run, { kind: 'changed', reason: 'シートが変わっている' });

    expect(text).toContain('シートが変わっている');
    // VERIFIED と FAIL の 2 件が「人が見て置いた」分。AUTO_PASS は人が見ていない。
    expect(text).toContain('2 件');
  });

  /**
   * **AI が出した FAIL / BLOCKED を、人が置いたと数えない**（2026-09-28・実物で見つけた）。
   *
   * 結果の欄だけで数えていたので、**人が何も置いていない実行で「人が見て置いた判定: 1 件」**と出た
   * （AI が BLOCKED にした 1 件）。**人が見たか・見ていないかを混ぜない**のが、この製品の芯（C1）。
   */
  it('AI が出した FAIL / BLOCKED は、人が置いた数に入れない', () => {
    const text = renderSheetCheck(
      {
        ...run,
        cases: [
          { no: 1, result: 'BLOCKED' },
          { no: 2, result: 'FAIL' },
        ],
      },
      { kind: 'same', reason: 'シートは同じ' },
    );

    expect(text).toContain('人が見て置いた判定: 0 件 / 全 2 件');
  });

  it('シートが読めないときも、証跡の中身は出す', () => {
    const text = renderSheetCheck(run, { kind: 'missing', reason: 'シートが読めない' });

    expect(text).toContain('シートが読めない');
    expect(text).toContain('ある検証');
  });
});
