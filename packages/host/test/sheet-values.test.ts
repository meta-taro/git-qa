import { describe, expect, it } from 'vitest';

import { valuesFromEnv } from '../src/sheet-values.js';

/** **シートに書けない値を、起こした環境から取る**（C113）。空は「無い」。 */
describe('valuesFromEnv', () => {
  const values = valuesFromEnv({ LICENSE_KEY: 'ABCD-1234', EMPTY: '' });

  it('在る名前は値を返す', () => {
    expect(values('LICENSE_KEY')).toBe('ABCD-1234');
  });

  it('無い名前・空の値は undefined（空を打っても確かめたことにならない）', () => {
    expect(values('MISSING')).toBeUndefined();
    expect(values('EMPTY')).toBeUndefined();
  });
});
