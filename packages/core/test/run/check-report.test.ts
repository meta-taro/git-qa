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
  cases: [
    { no: 1, result: 'VERIFIED' },
    { no: 2, result: 'AUTO_PASS' },
    { no: 3, result: 'FAIL' },
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

  it('シートが読めないときも、証跡の中身は出す', () => {
    const text = renderSheetCheck(run, { kind: 'missing', reason: 'シートが読めない' });

    expect(text).toContain('シートが読めない');
    expect(text).toContain('ある検証');
  });
});
