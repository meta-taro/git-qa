// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { devicePoint, screenPoint } from '../../src/session/touch.js';

/**
 * **触る側の逆。**
 *
 * 触るときは「枠の中で押した所 → 映像の中の座標」（`devicePoint`）。
 * 指すときは「映像の中の座標 → 枠の中のどこに描かれているか」（`screenPoint`）。
 *
 * canvas は `object-fit: contain` で描かれるので、**枠と映像で比が違えば余白が出る。**
 * そこを踏まないと、矢印が映像の外を指す。
 */
const rect = { left: 100, top: 50, width: 400, height: 400 };

describe('screenPoint', () => {
  it('映像の中央は、描かれている絵の中央になる', () => {
    // 200x400 の映像を 400x400 の枠へ入れると、横に余白が 100 ずつ出る。
    const at = screenPoint({ x: 100, y: 200, rect, canvas: { width: 200, height: 400 } });

    expect(at).toEqual({ x: 100 + 200, y: 50 + 200 });
  });

  it('触る側と往復して、元へ戻る', () => {
    const canvas = { width: 200, height: 400 };
    const on = screenPoint({ x: 40, y: 300, rect, canvas });

    expect(on).toBeDefined();
    const back = devicePoint({
      clientX: (on as { x: number }).x,
      clientY: (on as { y: number }).y,
      rect,
      canvas,
    });

    expect(back).toEqual({ x: 40, y: 300 });
  });

  it('測れないときは指さない（見当違いの所を指すより、指さないほうがよい）', () => {
    expect(
      screenPoint({ x: 1, y: 1, rect: { ...rect, width: 0 }, canvas: { width: 10, height: 10 } }),
    ).toBeUndefined();
    expect(screenPoint({ x: 1, y: 1, rect, canvas: { width: 0, height: 10 } })).toBeUndefined();
  });
});
