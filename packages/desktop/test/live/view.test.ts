// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { renderColumns } from '../../src/render.js';
import { mountLiveView } from '../../src/live/view.js';

describe('mountLiveView', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
  });

  it('中央（ライブビュー）のカラムの中に canvas を置く', () => {
    // 別窓ではなく枠の中に出すのが C27 の方式 A。
    mountLiveView(root, { width: 720, height: 1280 });

    const live = root.querySelector('[data-column-id="live"]');
    const canvas = live?.querySelector('canvas.live-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('width')).toBe('720');
  });

  it('左右のカラムには置かない', () => {
    mountLiveView(root, { width: 10, height: 20 });

    expect(root.querySelector('[data-column-id="cases"] canvas')).toBeNull();
    expect(root.querySelector('[data-column-id="verdict"] canvas')).toBeNull();
  });

  it('「まだ何も無い」の説明文を外す', () => {
    // 映像の上に説明文が残ると、出ているのか出ていないのか分からない。
    mountLiveView(root, { width: 10, height: 20 });

    expect(root.querySelector('[data-column-id="live"] .column-placeholder')).toBeNull();
  });

  it('外すと説明文が戻る', () => {
    const surface = mountLiveView(root, { width: 10, height: 20 });
    surface.unmount();

    expect(root.querySelector('[data-column-id="live"] canvas')).toBeNull();
    expect(root.querySelector('[data-column-id="live"] .column-placeholder')).not.toBeNull();
  });

  it('カラムが無い画面へ置こうとしたら、黙って諦めず落ちる', () => {
    // 構成を変えたときに、静かに映らなくなるのを防ぐ。
    const empty = document.createElement('div');
    expect(() => mountLiveView(empty, { width: 1, height: 1 })).toThrow(/カラム/);
  });
});
