import { describe, expect, it } from 'vitest';

import { NOT_FRONT_MARK, inFrontScript } from '../src/click.js';
import { keyAction, keyScript } from '../src/keys.js';

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

/**
 * **キーを送る前に、相手を前面に出して確かめる**（meta-taro/git-qa#34・2026-09-30）。
 *
 * `System Events` のキーは、**そのとき手前にある窓**へ行く。人が見ている git-qa の窓が手前だと、
 * **AI が打った `a` が「判定できない」を押したのと同じ**になっていた。人が作業中の別のアプリにも入りうる。
 * 押すとき（`clickScript`）と同じく、**出たことを確かめてからでないと送らない。**
 */
describe('inFrontScript', () => {
  const said = inFrontScript('dbboard', keyAction('Enter'));

  it('相手を前面に出し、出るまで待つ', () => {
    expect(said).toContain('tell application "dbboard" to activate');
    expect(said).toContain('repeat 25 times');
  });

  it('前面が相手でなければ、送らずに印を返す', () => {
    const check = said.indexOf(`return "${NOT_FRONT_MARK} "`);
    const send = said.indexOf('key code 36');
    expect(check).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(check);
  });

  it('文字も同じ道で送る', () => {
    expect(inFrontScript('dbboard', 'keystroke "abc"')).toContain('keystroke "abc"');
  });
});

describe('keyAction', () => {
  it('System Events に渡す中身だけを返す（keyScript と同じ中身）', () => {
    expect(keyAction('Ctrl+Enter')).toBe('key code 36 using {control down}');
    expect(keyScript('Ctrl+Enter')).toBe(
      'tell application "System Events" to key code 36 using {control down}',
    );
  });
});
