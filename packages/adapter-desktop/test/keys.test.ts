import { describe, expect, it } from 'vitest';

import { keyScript } from '../src/keys.js';

/**
 * **キーを本当に押す**（外部レビュー meta-taro/git-qa#6）。
 *
 * それまで `System Events` の `keystroke` を使っていた。あれは**文字を打つ**ので、
 *
 * ```applescript
 * tell application "System Events" to keystroke "Enter"
 * ```
 *
 * は **「Enter」という 5 文字が入る。**特殊キーには `key code` が要る。
 * **押したつもりで文字が入る**ほうが、押せないより悪い（黙って別のことをする）。
 */
describe('keyScript', () => {
  it('Enter は key code で送る', () => {
    const said = keyScript('Enter');

    expect(said).toContain('key code 36');
    expect(said).not.toContain('keystroke');
  });

  it('Esc / Tab / 矢印も名前で分かる', () => {
    expect(keyScript('Escape')).toContain('key code 53');
    expect(keyScript('Tab')).toContain('key code 48');
    expect(keyScript('ArrowDown')).toContain('key code 125');
  });

  /** **修飾キーは `using` で付ける。**押しっぱなしを自分で組まない。 */
  it('修飾キーつき', () => {
    const said = keyScript('Ctrl+Enter');

    expect(said).toContain('key code 36');
    expect(said).toContain('control down');
  });

  it('複数の修飾キー', () => {
    const said = keyScript('Cmd+Shift+P');

    expect(said).toContain('command down');
    expect(said).toContain('shift down');
  });

  /** 1 文字のキーは、そのまま打つ（`keystroke` が正しい相手）。 */
  it('ふつうの文字は keystroke', () => {
    expect(keyScript('a')).toContain('keystroke "a"');
  });

  /**
   * **知らないキーを、当てずっぽうで打たない。**
   * 打つと「押したつもりで別の文字が入る」——いちばん見つけにくい壊れ方。
   */
  it('知らない名前は断る', () => {
    expect(() => keyScript('Hyper')).toThrow('Hyper');
  });
});
