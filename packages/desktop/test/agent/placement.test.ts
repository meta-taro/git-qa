import { describe, expect, it } from 'vitest';

import { EDGE_PX, bubblePlacement, showMs } from '../../src/agent/placement.js';

/**
 * 吹き出しの置き場所（C120）。**窓の四隅・四辺の近くを指しても、窓の中に収まり、しっぽは指した所を向く。**
 *
 * happy-dom は組み版をしないので、ここは数で確かめる（実物の画面は人が目で見る）。
 */

const view = { width: 1200, height: 800 };
const size = { width: 280, height: 60 };
/** 幅 80・高さ 24 の的を、左上の角 (x, y) に置く。 */
const spot = (x: number, y: number) => ({ left: x, top: y, right: x + 80, bottom: y + 24 });
const anchorOf = (r: ReturnType<typeof spot>) => ({ x: r.left + 40, y: r.top + 12 });

const inside = (place: { left: number; top: number }): void => {
  expect(place.left).toBeGreaterThanOrEqual(EDGE_PX);
  expect(place.top).toBeGreaterThanOrEqual(EDGE_PX);
  expect(place.left + size.width).toBeLessThanOrEqual(view.width - EDGE_PX);
  expect(place.top + size.height).toBeLessThanOrEqual(view.height - EDGE_PX);
};

describe('bubblePlacement', () => {
  const spots = {
    左上: spot(4, 4),
    上: spot(560, 4),
    右上: spot(1116, 4),
    右: spot(1116, 388),
    右下: spot(1116, 772),
    下: spot(560, 772),
    左下: spot(4, 772),
    左: spot(4, 388),
    中央: spot(560, 388),
  };

  for (const [name, target] of Object.entries(spots)) {
    it(`${name}の的を指しても、吹き出しは窓の中に収まり、的に重ならない`, () => {
      const place = bubblePlacement(target, anchorOf(target), size, view);

      inside(place);
      if (place.side === 'above') expect(place.top + size.height).toBeLessThanOrEqual(target.top);
      if (place.side === 'below') expect(place.top).toBeGreaterThanOrEqual(target.bottom);
      if (place.side === 'right') expect(place.left).toBeGreaterThanOrEqual(target.right);
      if (place.side === 'left') expect(place.left + size.width).toBeLessThanOrEqual(target.left);
    });
  }

  it('上に入れば上、入らなければ下（上 → 下の順）', () => {
    expect(bubblePlacement(spots.中央, anchorOf(spots.中央), size, view).side).toBe('above');
    expect(bubblePlacement(spots.上, anchorOf(spots.上), size, view).side).toBe('below');
  });

  it('しっぽは指した所を向く（横にずらしても、しっぽの位置は的の上に残る）', () => {
    const target = spots.右上;
    const anchor = anchorOf(target);
    const place = bubblePlacement(target, anchor, size, view);

    // 吹き出しは左へ寄せられるが、しっぽ（left + tail）は的の中。
    expect(place.left + place.tail).toBeGreaterThanOrEqual(target.left);
    expect(place.left + place.tail).toBeLessThanOrEqual(target.right);
  });

  it('上下に入らない縦長の的は、右か左に置く', () => {
    const tall = { left: 500, top: 20, right: 700, bottom: 780 };
    const place = bubblePlacement(tall, { x: 540, y: 400 }, size, view);

    expect(place.side).toBe('right');
    inside(place);
  });

  it('どこにも入らなければ、窓の中へ寄せて重ねる（はみ出すより読める方を先にする）', () => {
    const huge = { left: 0, top: 0, right: 1200, bottom: 800 };
    const place = bubblePlacement(huge, { x: 40, y: 400 }, size, view);

    inside(place);
  });
});

describe('showMs', () => {
  it('秒数を渡せばそれ、渡さなければ文の長さ（最低 5 秒・上限 20 秒）、文が無ければ枠の時間', () => {
    expect(showMs('a', 3)).toBe(3000);
    expect(showMs('')).toBe(2600);
    expect(showMs('短い')).toBe(5200);
    expect(showMs('あ'.repeat(400))).toBe(20000);
  });
});
