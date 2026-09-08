import { describe, expect, it } from 'vitest';

import { parseSessionState } from '../../src/session/protocol.js';

/**
 * **要望シート No.1（2026-09-04・使った人が書いた）。**
 *
 * > ある場所に矢印うにうにしたり、該当箇所四角く案内したりできますかね？
 * > ずっと四角があると、ちゃんとみれないのでゆっくり点滅するとか。
 * > まぁ赤い矢印がここ、ここ🎵みたいにゆれてるほうがいいか。
 *
 * **どこを触ったかは、いまアダプタの中にしか無い。**画面まで運ぶ道が要る。
 * 座標は**映像の中の座標**（`screen` がその映像の実寸）。画面側で枠の大きさへ直す。
 */
const base = { runId: 'r', phase: 'running', cases: [] };

describe('parseSessionState — 指す場所', () => {
  it('触った場所と、その映像の実寸を読む', () => {
    const state = parseSessionState({
      ...base,
      pointing: { x: 100, y: 200, screen: { x: 1100, y: 720 }, label: '「管理」' },
    });

    expect(state?.pointing).toEqual({
      x: 100,
      y: 200,
      screen: { x: 1100, y: 720 },
      label: '「管理」',
    });
  });

  it('名前は無くてよい（座標だけでも指せる）', () => {
    const state = parseSessionState({
      ...base,
      pointing: { x: 1, y: 2, screen: { x: 10, y: 20 } },
    });

    expect(state?.pointing?.label).toBeUndefined();
  });

  it('無ければ持たない（何も指さない）', () => {
    expect(parseSessionState(base)?.pointing).toBeUndefined();
  });

  /** **形が違えば捨てる。**当て推量で別の場所を指すと、人を誤らせる。 */
  it('形が違うものは、状態ごと捨てる', () => {
    expect(parseSessionState({ ...base, pointing: { x: 1 } })).toBeUndefined();
    expect(parseSessionState({ ...base, pointing: { x: 1, y: 2 } })).toBeUndefined();
    expect(
      parseSessionState({ ...base, pointing: { x: 'a', y: 2, screen: { x: 1, y: 1 } } }),
    ).toBeUndefined();
    expect(parseSessionState({ ...base, pointing: 'ここ' })).toBeUndefined();
  });

  it('映像の実寸が 0 なら捨てる（枠へ直せない）', () => {
    expect(
      parseSessionState({ ...base, pointing: { x: 1, y: 2, screen: { x: 0, y: 10 } } }),
    ).toBeUndefined();
  });
});
