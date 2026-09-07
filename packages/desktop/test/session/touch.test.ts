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

  it('測れない値は送らない（NaN が境界の判定をすり抜ける）', () => {
    expect(devicePoint({ clientX: Number.NaN, clientY: 400, rect, canvas })).toBeUndefined();
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
    const ignored = vi.fn();
    installDeviceTouch({ canvas: canvasEl, state, send, now: () => clock, onIgnored: ignored });
    return { canvasEl, send, ignored };
  };

  let clock = 0;

  /** 枠の中央を基準に、px ずらした位置で押す / 離す。 */
  const at = (dx: number, dy: number) => ({
    clientX: rect.left + rect.width / 2 + dx,
    clientY: rect.top + rect.height / 2 + dy,
    bubbles: true,
  });

  const press = (canvasEl: HTMLCanvasElement, dx = 0, dy = 0): void => {
    canvasEl.dispatchEvent(new MouseEvent('mousedown', at(dx, dy)));
  };
  const release = (canvasEl: HTMLCanvasElement, dx = 0, dy = 0): void => {
    canvasEl.dispatchEvent(new MouseEvent('mouseup', at(dx, dy)));
  };

  it('同じ所で押して離したら、タップ', () => {
    clock = 0;
    const { canvasEl, send } = setup(() => waiting);

    press(canvasEl);
    clock = 80;
    release(canvasEl);

    // **どの大きさの画面上の座標かを添える。**受け取った側が端末の実寸へ戻す。
    expect(send).toHaveBeenCalledWith({
      kind: 'tap',
      caseNo: 2,
      x: 540,
      y: 1110,
      screen: { x: 1080, y: 2220 },
    });
  });

  it('離れた所で離したら、なぞった操作として送る（フリック）', () => {
    // **タップだけでは Android を操作できない。**ホームへ戻る動きがこれ。
    clock = 0;
    const { canvasEl, send } = setup(() => waiting);

    press(canvasEl, 0, 100);
    clock = 150;
    release(canvasEl, 0, -100);

    const input = send.mock.calls[0]?.[0] as {
      kind: string;
      from: { y: number };
      to: { y: number };
      durationMs: number;
    };
    expect(input.kind).toBe('swipe');
    // 上へなぞったので、終点のほうが小さい（画面の上ほど y が小さい）。
    expect(input.to.y).toBeLessThan(input.from.y);
    expect(input.durationMs).toBe(150);
  });

  it('同じ所で長く押したら、長押しとして送る（メニューを出す操作）', () => {
    clock = 0;
    const { canvasEl, send } = setup(() => waiting);

    press(canvasEl);
    clock = 900;
    release(canvasEl);

    expect(send.mock.calls[0]?.[0]).toMatchObject({ kind: 'longPress', durationMs: 900 });
  });

  it('短く押したらタップ（長押しとの境目）', () => {
    clock = 0;
    const { canvasEl, send } = setup(() => waiting);

    press(canvasEl);
    clock = 200;
    release(canvasEl);

    expect(send.mock.calls[0]?.[0]).toMatchObject({ kind: 'tap' });
  });

  it('余白（黒い所）から始めたら送らない', () => {
    clock = 0;
    const { canvasEl, send } = setup(() => waiting);

    canvasEl.dispatchEvent(
      new MouseEvent('mousedown', {
        clientX: rect.left + 2,
        clientY: rect.top + 400,
        bubbles: true,
      }),
    );
    clock = 50;
    release(canvasEl);

    expect(send).not.toHaveBeenCalled();
  });

  it('押さずに離しただけでは送らない', () => {
    const { canvasEl, send } = setup(() => waiting);

    release(canvasEl);

    expect(send).not.toHaveBeenCalled();
  });

  it('AI が操作している最中は送らない（どちらが触ったか分からなくなる）', () => {
    clock = 0;
    const { canvasEl, send } = setup(() => ({ ...waiting, phase: 'running' }));

    press(canvasEl);
    clock = 50;
    release(canvasEl);

    expect(send).not.toHaveBeenCalled();
  });

  it('実行が終わっていたら送らない', () => {
    const { canvasEl, send } = setup(() => undefined);

    press(canvasEl);
    release(canvasEl);

    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * **2026-09-07、人が 2 度「クリックしても反応しない」と言った。**
 *
 * 押した操作が捨てられていたのに、**捨てた側が何も言わなかった。**
 * ログにも画面にも出ないので、届いていないのか・届いて弾かれたのかが分からない。
 * **黙って捨てない**（product-baseline §8）。
 */
describe('installDeviceTouch — 捨てたときに理由を言う', () => {
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
    const ignored = vi.fn();
    installDeviceTouch({ canvas: canvasEl, state, send, now: () => 0, onIgnored: ignored });
    return { canvasEl, send, ignored };
  };

  const press = (canvasEl: HTMLCanvasElement): void => {
    canvasEl.dispatchEvent(
      new MouseEvent('mousedown', {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
      }),
    );
  };

  it('AI が操作している最中なら、そう言って捨てる', () => {
    const { canvasEl, send, ignored } = setup(() => ({ ...waiting, phase: 'running' }));

    press(canvasEl);

    expect(send).not.toHaveBeenCalled();
    expect(String(ignored.mock.calls[0]?.[0])).toContain('running');
  });

  it('まだ状態を受け取っていないなら、そう言って捨てる', () => {
    const { canvasEl, ignored } = setup(() => undefined);

    press(canvasEl);

    expect(String(ignored.mock.calls[0]?.[0])).toContain('状態');
  });

  it('余白を押したなら、そう言って捨てる', () => {
    const { canvasEl, ignored } = setup(() => waiting);

    canvasEl.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true }));

    expect(String(ignored.mock.calls[0]?.[0])).toContain('余白');
  });

  it('送れたときは何も言わない', () => {
    const { canvasEl, ignored } = setup(() => waiting);

    press(canvasEl);

    expect(ignored).not.toHaveBeenCalled();
  });
});
