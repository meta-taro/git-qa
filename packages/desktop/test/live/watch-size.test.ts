// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { watchSize } from '../../src/live/watch-size.js';

/**
 * **枠が変わったことを、誰かが伝えないといけない**（外部レビュー meta-taro/git-qa#15）。
 *
 * > `ResizeObserver` も `resize` の待ち受けも見当たらず、
 * > `showPointer` の呼び出しは `main.ts:459` の一か所だけでした。
 * > **枠が変わったことを誰も矢印に伝えていません。**
 *
 * その呼び出しは**状態が届いたときだけ**通る。判定を待っている間は状態が来ないので、
 * **待っている間に窓を変えると、そのままずれ続ける。**
 *
 * **窓の大きさだけを見ても足りない。**カラムの区切りを動かしても枠は変わるが、
 * そちらは `resize` では拾えない。**要素の大きさそのものを見張る。**
 */
describe('watchSize', () => {
  let target: HTMLElement;
  /** 見張りに渡された関数。**happy-dom は大きさを動かさない**ので、試験から叩く。 */
  let fired: (() => void) | undefined;
  let watching: Element | undefined;
  let stopped = false;

  class FakeObserver {
    constructor(callback: () => void) {
      fired = callback;
    }
    observe(el: Element): void {
      watching = el;
    }
    disconnect(): void {
      stopped = true;
    }
  }

  /** 窓の代わり。**待ち受けの口も差し替える**（本物の窓に残すと、次の試験へ漏れる）。 */
  let listened: ReadonlyArray<[string, unknown]> = [];
  let dropped: ReadonlyArray<[string, unknown]> = [];
  const viewWith = (observer: unknown): Window =>
    ({
      ResizeObserver: observer,
      addEventListener: (name: string, fn: unknown) => (listened = [...listened, [name, fn]]),
      removeEventListener: (name: string, fn: unknown) => (dropped = [...dropped, [name, fn]]),
    }) as unknown as Window;

  beforeEach(() => {
    document.body.replaceChildren();
    target = document.createElement('div');
    document.body.append(target);
    fired = undefined;
    listened = [];
    dropped = [];
    watching = undefined;
    stopped = false;
  });

  it('その要素の大きさを見張る', () => {
    watchSize(target, vi.fn(), viewWith(FakeObserver));

    expect(watching).toBe(target);
  });

  it('大きさが変わったら教える', () => {
    const told = vi.fn();
    watchSize(target, told, viewWith(FakeObserver));

    fired?.();

    expect(told).toHaveBeenCalledTimes(1);
  });

  it('止めたら、見張りも止める', () => {
    const stop = watchSize(target, vi.fn(), viewWith(FakeObserver));

    stop();

    expect(stopped).toBe(true);
  });

  /**
   * **`ResizeObserver` が無い器でも動く。**無ければ窓の大きさだけでも見る。
   * 区切りを動かした分は拾えないが、**何も拾えないよりはよい。**
   */
  it('ResizeObserver が無ければ、窓の大きさを見る', () => {
    const view = viewWith(undefined);
    const told = vi.fn();

    const stop = watchSize(target, told, view);
    expect(listened.map(([name]) => name)).toEqual(['resize']);

    // 待ち受けている関数を叩く（happy-dom は大きさを動かさない）。
    (listened[0]?.[1] as () => void)();
    stop();

    expect(told).toHaveBeenCalledTimes(1);
    expect(dropped.map(([name]) => name)).toEqual(['resize']);
  });
});
