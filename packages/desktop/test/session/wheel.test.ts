// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@git-qa/core/session';

import { installDeviceWheel, wheelPixels } from '../../src/session/wheel.js';

/**
 * ライブビューの上でホイールを回したら、端末をスクロールさせる。
 *
 * **タップとなぞるだけでは、長い画面の下が見られない。**人が見て判断するための道具なので、
 * 見えない所が残るのは困る。
 *
 * **回すたびに送らない。**ホイールは 1 回転で何十回も飛んでくる。そのたびに `input swipe`
 * を出すと adb が詰まり、端末は追いつけない。**貯めてから 1 回のなぞりにする。**
 */

const canvas = { width: 1080, height: 2220 };
const rect = { left: 100, top: 50, width: 800, height: 800 };

describe('wheelPixels — 回した量を画素にする', () => {
  it('画素で来たものは、そのまま', () => {
    expect(wheelPixels({ deltaX: 3, deltaY: 20, deltaMode: 0 })).toEqual({ dx: 3, dy: 20 });
  });

  it('行で来たものは、行の高さを掛ける', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 2, deltaMode: 1 })).toEqual({ dx: 0, dy: 32 });
  });

  it('頁で来たものは、画面 1 つ分にする', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: -1, deltaMode: 2, pageHeight: 900 })).toEqual({
      dx: 0,
      dy: -900,
    });
  });
});

describe('installDeviceWheel', () => {
  const waiting: SessionState = {
    runId: 'r',
    phase: 'waiting',
    awaiting: 2,
    cases: [{ no: 2, title: 'メモを保存できる', aiResult: 'BLOCKED' }],
  };

  const setup = (state: () => SessionState | undefined = () => waiting) => {
    const canvasEl = document.createElement('canvas');
    canvasEl.width = canvas.width;
    canvasEl.height = canvas.height;
    canvasEl.getBoundingClientRect = () => ({
      ...rect,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const send = vi.fn();
    const stop = installDeviceWheel({ canvas: canvasEl, state, send });
    return { canvasEl, send, stop };
  };

  /** happy-dom の WheelEvent は clientX / clientY を落とすので、こちらで持たせる。 */
  const spin = (canvasEl: HTMLCanvasElement, deltaY: number): void => {
    const event = new WheelEvent('wheel', {
      deltaY,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'clientX', { value: rect.left + rect.width / 2 });
    Object.defineProperty(event, 'clientY', { value: rect.top + rect.height / 2 });
    canvasEl.dispatchEvent(event);
  };

  it('少し回しただけでは、まだ送らない（1 回ごとに送ると adb が詰まる）', () => {
    vi.useFakeTimers();
    const { canvasEl, send } = setup();

    spin(canvasEl, 10);

    expect(send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('手を止めたら、貯めた分をまとめて 1 回のなぞりにする', () => {
    vi.useFakeTimers();
    const { canvasEl, send } = setup();

    spin(canvasEl, 40);
    spin(canvasEl, 40);
    vi.advanceTimersByTime(200);

    expect(send).toHaveBeenCalledOnce();
    const input = send.mock.calls[0]?.[0] as {
      kind: string;
      from: { y: number };
      to: { y: number };
    };
    expect(input.kind).toBe('swipe');
    // **下へスクロール＝指は上へ動く。**逆にすると画面が逆に動く。
    expect(input.to.y).toBeLessThan(input.from.y);
  });

  it('上へ回したら、指は下へ動く', () => {
    vi.useFakeTimers();
    const { canvasEl, send } = setup();

    spin(canvasEl, -80);
    vi.advanceTimersByTime(200);

    const input = send.mock.calls[0]?.[0] as { from: { y: number }; to: { y: number } };
    expect(input.to.y).toBeGreaterThan(input.from.y);
    vi.useRealTimers();
  });

  it('回し続けたら、溜まりきる前に送る（止まるまで待たない）', () => {
    vi.useFakeTimers();
    const { canvasEl, send } = setup();

    for (let i = 0; i < 20; i += 1) spin(canvasEl, 40);

    expect(send).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('人の番でなければ送らない（AI が触っている最中に割り込まない）', () => {
    vi.useFakeTimers();
    const { canvasEl, send } = setup(() => ({ ...waiting, phase: 'running' }));

    spin(canvasEl, 200);
    vi.advanceTimersByTime(200);

    expect(send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('止めたら、もう拾わない', () => {
    vi.useFakeTimers();
    const { canvasEl, send, stop } = setup();

    stop();
    spin(canvasEl, 200);
    vi.advanceTimersByTime(200);

    expect(send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
