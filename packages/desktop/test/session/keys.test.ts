import { describe, expect, it } from 'vitest';

import { KEY_BINDINGS, commandForKey } from '../../src/session/keys.js';

/**
 * 人が押すキー。**1 打鍵で置いて、次へ進む**（C6）。
 *
 * Enter も修飾キーも要求しない。要求すると、見ながら押す動作が 2 手になり、
 * 「見た人がその場で置く」という前提が崩れる。
 */

describe('commandForKey', () => {
  it('v で VERIFIED を置く', () => {
    expect(commandForKey({ key: 'v' })).toEqual({ kind: 'verdict', humanResult: 'VERIFIED' });
  });

  it('f / b / s で FAIL / BLOCKED / SKIP を置く', () => {
    expect(commandForKey({ key: 'f' })).toEqual({ kind: 'verdict', humanResult: 'FAIL' });
    expect(commandForKey({ key: 'b' })).toEqual({ kind: 'verdict', humanResult: 'BLOCKED' });
    expect(commandForKey({ key: 's' })).toEqual({ kind: 'verdict', humanResult: 'SKIP' });
  });

  it('空白は、置かずに次へ送る（AUTO_PASS のまま）', () => {
    expect(commandForKey({ key: ' ' })).toEqual({ kind: 'advance' });
  });

  it('取り消し（u）はまだ割り当てない', () => {
    // **押しても何も起きないキーを作らない。**取り消しは、確定したケースを
    // コア側で開け直す仕組みが要る（Issue 004 の既知の穴）。
    expect(commandForKey({ key: 'u' })).toBeUndefined();
  });

  it('大文字でも同じ（Shift を押したまま打っても効く）', () => {
    expect(commandForKey({ key: 'V' })).toEqual({ kind: 'verdict', humanResult: 'VERIFIED' });
  });

  it('修飾キー付きは受け取らない（OS や webview の操作を奪わない）', () => {
    expect(commandForKey({ key: 'v', metaKey: true })).toBeUndefined();
    expect(commandForKey({ key: 'v', ctrlKey: true })).toBeUndefined();
    expect(commandForKey({ key: 'v', altKey: true })).toBeUndefined();
  });

  it('割り当てていないキーは何もしない', () => {
    expect(commandForKey({ key: 'x' })).toBeUndefined();
    expect(commandForKey({ key: 'Enter' })).toBeUndefined();
  });

  it('キー一覧は、実際の割り当てと同じものを出す', () => {
    // **人へ出す説明が実装とずれない**ようにする。ずれた説明は、無い説明より悪い。
    for (const binding of KEY_BINDINGS) {
      expect(commandForKey({ key: binding.key })).toBeDefined();
    }
  });
});
