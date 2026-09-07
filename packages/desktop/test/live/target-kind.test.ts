import { describe, expect, it } from 'vitest';

import { targetKindFromLocation } from '../../src/live/stream.js';

/**
 * **2026-09-07、人の判断。**
 *
 * > デスクトップアプリの時だけ最悪補助ボタンとかでいいです。注意書きで、
 * > もしくは実物を操作してくださいみたいな
 *
 * デスクトップアプリだけ、**なぞる・掴んで運ぶで指が一瞬飛ぶ**（macOS に
 * 指を動かさず窓へ届ける口が無い・C57）。ウェブと Android は起きない
 * （ブラウザ／端末の中へ命令を送るので、Mac の指は動かない）。
 *
 * **できないことを、できるふりで隠さない。**相手がデスクトップのときだけ断りを出す。
 */
describe('targetKindFromLocation', () => {
  it('デスクトップだと言われたら、そう返す', () => {
    expect(targetKindFromLocation('?targetkind=desktop')).toBe('desktop');
  });

  it('何も言われなければ undefined（当て推量で断りを出さない）', () => {
    expect(targetKindFromLocation('')).toBeUndefined();
    expect(targetKindFromLocation('?livekind=images')).toBeUndefined();
  });

  it('知らない値は undefined', () => {
    expect(targetKindFromLocation('?targetkind=なにか')).toBeUndefined();
  });
});
