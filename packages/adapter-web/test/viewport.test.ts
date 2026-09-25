import { describe, expect, it } from 'vitest';

import { parseViewport, viewportScript } from '../src/find.js';

/**
 * **映像の実寸を、ブラウザに聞く**（2026-09-25・人が実物で見つけた）。
 *
 * > デスクトップアプリ、うぇbのブラウザサイズとかも。
 *
 * 無いと 2 つ壊れる。
 *
 * 1. **赤い枠と矢印が一度も出ない。**実行側は実寸を聞けないと、指した場所を捨てる
 * 2. **人が触った所がずれる。**映像は画素、ブラウザが受け取るのは CSS 画素。
 *    比が 1 でない画面（Retina・縮めて流しているとき）では、そのまま送ると違う所を押す
 */

describe('ブラウザの見える大きさ', () => {
  it('聞く文は、CSS 画素の内寸を返す形になっている', () => {
    expect(viewportScript()).toContain('innerWidth');
    expect(viewportScript()).toContain('innerHeight');
  });

  it('返りを数に直す', () => {
    expect(parseViewport({ width: 1307, height: 971 })).toEqual({ width: 1307, height: 971 });
    // 端数は丸める（CSS 画素は小数になりうる）。
    expect(parseViewport({ width: 1306.5, height: 970.4 })).toEqual({ width: 1307, height: 970 });
  });

  /** **測れないまま既定を返さない。**当て推量の大きさは、見当違いの所を押させる。 */
  it('形が違う・0 以下なら undefined（勝手な既定を返さない）', () => {
    expect(parseViewport(undefined)).toBeUndefined();
    expect(parseViewport({ width: 0, height: 800 })).toBeUndefined();
    expect(parseViewport({ width: '1280', height: 800 })).toBeUndefined();
    expect(parseViewport({ width: Number.NaN, height: 800 })).toBeUndefined();
  });
});
