// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { renderColumns } from '../../src/render.js';
import { mountLiveView } from '../../src/live/view.js';
import { showPointer } from '../../src/live/pointer.js';

/**
 * **要望シート No.1（2026-09-04・使った人が書いた・3 日 未着手だった）。**
 *
 * > ある場所に矢印うにうにしたり、該当箇所四角く案内したりできますかね？
 * > ずっと四角があると、ちゃんとみれないのでゆっくり点滅するとか。
 * > まぁ赤い矢印がここ、ここ🎵みたいにゆれてるほうがいいか。
 *
 * **「ずっと出ていると、ちゃんと見れない」**が肝。出しっぱなしにしない。
 */
describe('showPointer', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
    const surface = mountLiveView(root, { width: 200, height: 400 });
    surface.canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      right: 400,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });

  it('指す場所が無ければ、何も出さない', () => {
    showPointer(root, undefined);

    expect(root.querySelector('.live-pointer')).toBeNull();
  });

  it('指す場所があれば、矢印を 1 つ置く', () => {
    showPointer(root, { x: 100, y: 200, screen: { x: 200, y: 400 } });

    expect(root.querySelectorAll('.live-pointer')).toHaveLength(1);
  });

  it('同じ所を続けて指しても、増やさない', () => {
    const at = { x: 100, y: 200, screen: { x: 200, y: 400 } };

    showPointer(root, at);
    showPointer(root, at);

    expect(root.querySelectorAll('.live-pointer')).toHaveLength(1);
  });

  /**
   * **2026-09-08、人に言われた。**
   *
   * > 矢印はいいけど、赤い一覧はじゃまです。
   *
   * 名前の札を映像の上へ置いていた。**指したい所の手前を、札が覆う。**
   * 「ずっと出ていると、ちゃんと見れない」という最初の要望と、同じ話だった。
   */
  it('名前の札は映像の上に置かない（指したい所を覆う）', () => {
    showPointer(root, { x: 10, y: 20, screen: { x: 200, y: 400 }, label: '「管理」' });

    expect(root.querySelector('.live-pointer')?.textContent).not.toContain('「管理」');
  });

  /**
   * **2026-09-08、人に言われた。**
   *
   * > カレンダー？カレンダーならかぶっちゃだめでしょ。
   *
   * 指した文字の上に矢印が載っていた。**押した物が見えないと意味が無い。**
   * 大きさが分かっているなら、**その左の外**へ置く。
   */
  it('大きさが分かっているなら、指すものの左の外へ置く', () => {
    // 200x400 の映像を 400x400 の枠へ入れると、倍率 1・横に余白が 100 ずつ。
    showPointer(root, { x: 100, y: 200, screen: { x: 200, y: 400 }, width: 40, height: 10 });

    const at = root.querySelector<HTMLElement>('.live-pointer');
    // 中心 100 の左端は 80。枠では 100 + 80 = 180。
    expect(at?.style.left).toBe('180px');
  });

  it('大きさが分からなければ、点をそのまま指す（当て推量で離さない）', () => {
    // 200x400 の映像を 400x400 の枠へ入れると、横に余白が 100 ずつ出る。
    showPointer(root, { x: 100, y: 200, screen: { x: 200, y: 400 } });

    const at = root.querySelector<HTMLElement>('.live-pointer');
    expect(at?.style.left).toBe('200px');
    expect(at?.style.top).toBe('200px');
  });

  it('指すのをやめたら、消す', () => {
    showPointer(root, { x: 1, y: 2, screen: { x: 200, y: 400 } });
    showPointer(root, undefined);

    expect(root.querySelector('.live-pointer')).toBeNull();
  });
});

/**
 * **2026-09-08、人に言われた。**
 *
 * > もうすこしいうと斜めから矢印をさしてほしかったというのがあります。
 * > ただ、画面外に矢印がでて見切れてしまうならいまのままでいいです。
 *
 * 斜めは**左上の角**から指す。ただし**映像の外へはみ出すなら、横向きに落とす**
 * （見切れた矢印は、どこを指しているか分からない）。
 */
describe('showPointer — 斜めから指す', () => {
  let root: HTMLElement;

  const setup = (): void => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
    const surface = mountLiveView(root, { width: 400, height: 400 });
    surface.canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      right: 400,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  };

  it('余地があるなら、斜めから指す', () => {
    setup();
    showPointer(root, { x: 200, y: 200, screen: { x: 400, y: 400 }, width: 60, height: 20 });

    expect(root.querySelector('.live-pointer')?.classList.contains('is-diagonal')).toBe(true);
  });

  it('上に余地が無ければ、横から指す（斜めだと見切れる）', () => {
    setup();
    showPointer(root, { x: 200, y: 8, screen: { x: 400, y: 400 }, width: 60, height: 12 });

    expect(root.querySelector('.live-pointer')?.classList.contains('is-diagonal')).toBe(false);
  });

  it('左に余地が無ければ、横から指す', () => {
    setup();
    showPointer(root, { x: 20, y: 200, screen: { x: 400, y: 400 }, width: 30, height: 20 });

    expect(root.querySelector('.live-pointer')?.classList.contains('is-diagonal')).toBe(false);
  });

  it('大きさが分からなければ、斜めにしない（角が分からない）', () => {
    setup();
    showPointer(root, { x: 200, y: 200, screen: { x: 400, y: 400 } });

    expect(root.querySelector('.live-pointer')?.classList.contains('is-diagonal')).toBe(false);
  });
});

/**
 * **矢印 1 つが要る余地。**
 *
 * ここに数字（`ARROW_ROOM`）があるのに、**検査で留めていなかった**
 * （2026-09-08、矢印を大きくしたついでに 26 → 38 へ動かした。テストを書いていない）。
 * **留めていない数字は、次に触った人が理由なく動かせる。**
 */
describe('showPointer — 斜めにする境目', () => {
  const setup = (): HTMLElement => {
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
    const surface = mountLiveView(root, { width: 400, height: 400 });
    surface.canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
      right: 400,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    return root;
  };

  const diagonalAt = (top: number): boolean => {
    const root = setup();
    // 高さ 20 の物の上端が `top` に来るように、中心を置く。
    showPointer(root, { x: 200, y: top + 10, screen: { x: 400, y: 400 }, width: 60, height: 20 });
    return root.querySelector('.live-pointer')?.classList.contains('is-diagonal') === true;
  };

  it('上に 38px あれば斜めにする', () => {
    expect(diagonalAt(38)).toBe(true);
  });

  it('37px しか無ければ横から指す', () => {
    expect(diagonalAt(37)).toBe(false);
  });
});
