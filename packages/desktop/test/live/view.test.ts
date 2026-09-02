// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { renderColumns } from '../../src/render.js';
import { mountLiveView, showLiveViewError } from '../../src/live/view.js';

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

  it('最初の絵が来たら、端末の実寸に合わせ直す', () => {
    // 引き伸ばすと、人が見て判断する材料が歪む。実寸は絵が来るまで分からない。
    const surface = mountLiveView(root, { width: 1080, height: 2220 });
    surface.draw({ close: () => {}, displayWidth: 1080, displayHeight: 2340 });

    expect(surface.canvas.width).toBe(1080);
    expect(surface.canvas.height).toBe(2340);
  });

  it('実寸を持たない絵では、大きさを変えない', () => {
    const surface = mountLiveView(root, { width: 720, height: 1280 });
    surface.draw({ close: () => {} });

    expect(surface.canvas.width).toBe(720);
    expect(surface.canvas.height).toBe(1280);
  });

  it('映らない理由を、中央のカラムに出す', () => {
    // console だけに出しても人には見えない。**見えないと、人は待ち続ける。**
    showLiveViewError(root, 'この webview は H.264 の復号に対応していない');

    const live = root.querySelector('[data-column-id="live"]');
    expect(live?.textContent).toContain('H.264 の復号に対応していない');
  });

  it('理由を出すときは、映像の枠を外す', () => {
    // 黒い枠が残ると、映っていないのか真っ黒なのかが分からない。
    mountLiveView(root, { width: 10, height: 20 });
    showLiveViewError(root, 'だめ');

    expect(root.querySelector('[data-column-id="live"] canvas')).toBeNull();
  });

  it('理由を二度出しても、積み重ならない', () => {
    showLiveViewError(root, '1 回目');
    showLiveViewError(root, '2 回目');

    const live = root.querySelector('[data-column-id="live"]');
    expect(live?.textContent).not.toContain('1 回目');
    expect(live?.textContent).toContain('2 回目');
  });

  it('カラムが無い画面へ置こうとしたら、黙って諦めず落ちる', () => {
    // 構成を変えたときに、静かに映らなくなるのを防ぐ。
    const empty = document.createElement('div');
    expect(() => mountLiveView(empty, { width: 1, height: 1 })).toThrow(/カラム/);
  });
});
