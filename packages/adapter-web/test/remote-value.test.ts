import { describe, expect, it } from 'vitest';

import { fromRemoteValue } from '../src/bidi.js';

/**
 * BiDi が返す値を、素の値へ戻す（Issue 018）。
 *
 * **CDP と違うのはここ。**CDP は `returnByValue` で素の値をくれるが、
 * BiDi は**型つき**で返す。オブジェクトは**組の並び**になる。
 *
 * 実測（2026-09-06・Firefox 155.0）:
 * ```
 * document.title    → {"type":"string","value":"Example Domain"}
 * ({a:1, b:"x"})    → {"type":"object","value":[["a",{"type":"number","value":1}],
 *                                               ["b",{"type":"string","value":"x"}]]}
 * ```
 *
 * **これを戻さないと、画面の文字が空になる。**実際に DOM が 0 文字で返ってきた。
 */

describe('fromRemoteValue', () => {
  it('文字をそのまま戻す', () => {
    expect(fromRemoteValue({ type: 'string', value: 'Example Domain' })).toBe('Example Domain');
  });

  it('数と真偽も戻す', () => {
    expect(fromRemoteValue({ type: 'number', value: 12 })).toBe(12);
    expect(fromRemoteValue({ type: 'boolean', value: true })).toBe(true);
  });

  it('オブジェクトは、組の並びから戻す', () => {
    expect(
      fromRemoteValue({
        type: 'object',
        value: [
          ['a', { type: 'number', value: 1 }],
          ['b', { type: 'string', value: 'x' }],
        ],
      }),
    ).toEqual({ a: 1, b: 'x' });
  });

  it('入れ子のオブジェクトも戻す', () => {
    expect(
      fromRemoteValue({
        type: 'object',
        value: [['point', { type: 'object', value: [['x', { type: 'number', value: 3 }]] }]],
      }),
    ).toEqual({ point: { x: 3 } });
  });

  it('配列も戻す', () => {
    expect(
      fromRemoteValue({
        type: 'array',
        value: [
          { type: 'number', value: 1 },
          { type: 'number', value: 2 },
        ],
      }),
    ).toEqual([1, 2]);
  });

  it('無いものは undefined（勝手に埋めない）', () => {
    expect(fromRemoteValue({ type: 'null' })).toBeNull();
    expect(fromRemoteValue({ type: 'undefined' })).toBeUndefined();
    expect(fromRemoteValue(undefined)).toBeUndefined();
  });

  /** **知らない型は undefined。**中途半端に読むと、読めたことになってしまう。 */
  it('知らない型は undefined', () => {
    expect(fromRemoteValue({ type: 'node', sharedId: 'abc' })).toBeUndefined();
  });
});
