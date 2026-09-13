import { describe, expect, it } from 'vitest';

import { keyEvents } from '../src/keys.js';

/**
 * **キーを本当に押す**（外部レビュー meta-taro/git-qa#6）。
 *
 * それまで `key` だけを送っていた。
 *
 * ```ts
 * cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: action.key });
 * ```
 *
 * **届くが、効かない。**実物で確かめた（2026-09-13）——
 * `<form onsubmit=…>` の中で Enter を送っても、題は変わらなかった。
 * Chrome は `windowsVirtualKeyCode` が無いと**既定の動作**（送信・改行）を起こさない。
 *
 * **「送った」と「効いた」は別。**
 */
describe('keyEvents', () => {
  it('Enter は番号と文字まで載せる', () => {
    const [down, up] = keyEvents('Enter');

    expect(down).toMatchObject({
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: '\r',
    });
    expect(up).toMatchObject({ type: 'keyUp', key: 'Enter' });
  });

  it('Esc / Tab / 矢印も分かる', () => {
    expect(keyEvents('Escape')[0]).toMatchObject({ windowsVirtualKeyCode: 27 });
    expect(keyEvents('Tab')[0]).toMatchObject({ windowsVirtualKeyCode: 9 });
    expect(keyEvents('ArrowDown')[0]).toMatchObject({ windowsVirtualKeyCode: 40 });
  });

  /** **修飾キーは重ねた数で渡す**（Alt 1 / Ctrl 2 / Meta 4 / Shift 8）。 */
  it('修飾キーつき', () => {
    const [down] = keyEvents('Ctrl+Enter');

    expect(down).toMatchObject({ modifiers: 2, key: 'Enter' });
  });

  it('複数の修飾キー', () => {
    expect(keyEvents('Ctrl+Shift+P')[0]).toMatchObject({ modifiers: 2 + 8 });
  });

  /** ふつうの 1 文字は、文字として送る。 */
  it('1 文字はそのまま', () => {
    expect(keyEvents('a')[0]).toMatchObject({ key: 'a', text: 'a' });
  });

  /** **知らないキーを、当てずっぽうで送らない。** */
  it('知らない名前は断る', () => {
    expect(() => keyEvents('Hyper')).toThrow('Hyper');
  });
});
