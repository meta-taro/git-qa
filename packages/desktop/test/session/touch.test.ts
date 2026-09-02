// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@git-qa/core/session';

import { devicePoint, installDeviceTouch } from '../../src/session/touch.js';

/**
 * 人がライブビューを押した所を、端末の座標へ直す（Issue 013）。
 *
 * **canvas は `object-fit: contain` で描かれる。**枠と端末で縦横比が違うと余白が出るので、
 * 押した位置をそのまま端末の座標にはできない。
 */

/** 1080x2220 の端末を、800x800 の枠に収めた場合。 */
const canvas = { width: 1080, height: 2220 };
const rect = { left: 100, top: 50, width: 800, height: 800 };

describe('devicePoint', () => {
  it('描かれている絵の中央を押したら、端末の中央になる', () => {
    // 収まる倍率は 800/2220。絵の幅は 1080 * (800/2220) ≒ 389.2、左右に余白。
    const point = devicePoint({
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      rect,
      canvas,
    });

    expect(point).toEqual({ x: 540, y: 1110 });
  });

  it('余白（黒い所）を押したら、端末へは送らない', () => {
    const point = devicePoint({ clientX: rect.left + 5, clientY: rect.top + 400, rect, canvas });

    expect(point).toBeUndefined();
  });

  it('枠の外は送らない', () => {
    expect(
      devicePoint({ clientX: rect.left - 10, clientY: rect.top + 10, rect, canvas }),
    ).toBeUndefined();
  });

  it('枠の寸法が測れないときは送らない', () => {
    expect(
      devicePoint({
        clientX: 10,
        clientY: 10,
        rect: { left: 0, top: 0, width: 0, height: 0 },
        canvas,
      }),
    ).toBeUndefined();
  });

  it('端末の画素は整数で返す', () => {
    const point = devicePoint({
      clientX: rect.left + rect.width / 2 + 1.3,
      clientY: rect.top + 123.7,
      rect,
      canvas,
    });

    expect(Number.isInteger(point?.x)).toBe(true);
    expect(Number.isInteger(point?.y)).toBe(true);
  });
});

describe('installDeviceTouch', () => {
  const waiting: SessionState = {
    runId: 'r',
    phase: 'waiting',
    awaiting: 2,
    cases: [{ no: 2, title: 'メモを保存できる', aiResult: 'BLOCKED' }],
  };

  const setup = (state: () => SessionState | undefined) => {
    const canvasEl = document.createElement('canvas');
    canvasEl.width = 1080;
    canvasEl.height = 2220;
    canvasEl.getBoundingClientRect = () => ({
      ...rect,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const send = vi.fn();
    installDeviceTouch({ canvas: canvasEl, state, send });
    return { canvasEl, send };
  };

  const clickCenter = (canvasEl: HTMLCanvasElement): void => {
    canvasEl.dispatchEvent(
      new MouseEvent('click', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
      }),
    );
  };

  it('人の番なら、押した所を送る', () => {
    const { canvasEl, send } = setup(() => waiting);

    clickCenter(canvasEl);

    expect(send).toHaveBeenCalledWith({ kind: 'tap', caseNo: 2, x: 540, y: 1110 });
  });

  it('AI が操作している最中は送らない（どちらが触ったか分からなくなる）', () => {
    const { canvasEl, send } = setup(() => ({ ...waiting, phase: 'running' }));

    clickCenter(canvasEl);

    expect(send).not.toHaveBeenCalled();
  });

  it('実行が終わっていたら送らない', () => {
    const { canvasEl, send } = setup(() => undefined);

    clickCenter(canvasEl);

    expect(send).not.toHaveBeenCalled();
  });
});
