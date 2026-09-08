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

  it('何を指しているかを、文字でも出す（矢印だけだと何の話か分からない）', () => {
    showPointer(root, { x: 10, y: 20, screen: { x: 200, y: 400 }, label: '「管理」' });

    expect(root.querySelector('.live-pointer')?.textContent).toContain('「管理」');
  });

  it('映像の実寸が枠と違っても、描かれている絵の上を指す', () => {
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
