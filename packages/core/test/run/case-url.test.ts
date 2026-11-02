import { describe, expect, it } from 'vitest';

import { maskQueryValues } from '../../src/run/case-url.js';

/**
 * **判定した時点の URL を証跡に残す**（meta-taro/git-qa#40）。
 *
 * 証跡は commit されるので、**クエリの値（メール・トークン）をそのまま残すとリポに入る。**
 * 名前は残し、値だけ伏せる。どの名前が付いていたかが分かれば、流れを復元するには足りる。
 */
describe('maskQueryValues', () => {
  it('クエリの値を伏せ、名前は残す', () => {
    expect(maskQueryValues('http://localhost:3000/ja/auth/login?email=a%40b.c&next=%2Fhome')).toBe(
      'http://localhost:3000/ja/auth/login?email=***&next=***',
    );
  });

  it('クエリが無ければ、そのまま', () => {
    expect(maskQueryValues('https://example.test/path/to')).toBe('https://example.test/path/to');
  });

  it('断片（#）は残す。値の無い名前も残す', () => {
    expect(maskQueryValues('https://example.test/a?flag&id=7#section')).toBe(
      'https://example.test/a?flag=***&id=***#section',
    );
  });

  it('URL として読めない文字列は、そのまま返す（伏せられないものを伏せたことにしない）', () => {
    expect(maskQueryValues('about:blank')).toBe('about:blank');
    expect(maskQueryValues('そもそも URL ではない')).toBe('そもそも URL ではない');
  });
});
