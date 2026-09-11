import { describe, expect, it } from 'vitest';

import { compareFingerprint } from '../../src/run/target-check.js';

/**
 * **走行中に相手が変わったことを、証跡に残す**（外部レビュー meta-taro/git-qa#3）。
 *
 * > シートは同一性を持っているのに、検証対象は持っていません。
 * > 前半 5 件は旧ビルド、後半 5 件は新ビルド、という証跡を作ります。
 * > そして run.json を読んだ人には、それが 1 つのビルドに見えます。
 *
 * **止めない。**この道具の考え方は「止める」ではなく「見る場所を絞る」なので、
 * **変わったことが読めれば足りる。**
 *
 * **「変わっていない」と「測れなかった」を混ぜない。**録画や画面と同じ考え方。
 */
describe('compareFingerprint', () => {
  it('同じなら same', () => {
    const check = compareFingerprint('abc', 'abc');

    expect(check).toEqual({ state: 'same', before: 'abc', after: 'abc' });
  });

  it('違えば changed（両方の値を残す）', () => {
    const check = compareFingerprint('abc', 'xyz');

    expect(check).toEqual({ state: 'changed', before: 'abc', after: 'xyz' });
  });

  /** **測れないことと、変わっていないことは別。** */
  it('前が測れなければ unmeasurable', () => {
    const check = compareFingerprint(undefined, 'xyz');

    expect(check.state).toBe('unmeasurable');
    if (check.state !== 'unmeasurable') throw new Error('unmeasurable のはず');
    expect(check.reason).toContain('前');
  });

  it('後が測れなければ unmeasurable', () => {
    const check = compareFingerprint('abc', undefined);

    expect(check.state).toBe('unmeasurable');
    if (check.state !== 'unmeasurable') throw new Error('unmeasurable のはず');
    expect(check.reason).toContain('後');
  });

  /** **どちらも測れない相手がいる。**その相手を「変わっていない」と書かない。 */
  it('どちらも測れなければ unmeasurable', () => {
    const check = compareFingerprint(undefined, undefined);

    expect(check.state).toBe('unmeasurable');
  });
});
