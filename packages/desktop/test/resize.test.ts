// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { COLUMNS } from '../src/columns.js';
import { renderColumns } from '../src/render.js';
import { installColumnResizers, nextFlex } from '../src/resize.js';

/**
 * カラムの区切り（Issue 012）。**どれだけ広く見たいかは、見る人と端末による。**
 */

describe('nextFlex — 幅の計算（DOM に依存しない）', () => {
  const base = { leftFlex: 1, rightFlex: 3, containerPx: 1000, minFlex: 0.2 };

  it('右へ動かすと、左が増えて右が同じだけ減る', () => {
    const next = nextFlex({ ...base, deltaPx: 100 });

    expect(next.left).toBeGreaterThan(1);
    expect(next.left + next.right).toBeCloseTo(4);
  });

  it('左へ動かすと、左が減って右が増える', () => {
    const next = nextFlex({ ...base, deltaPx: -100 });

    expect(next.left).toBeLessThan(1);
    expect(next.left + next.right).toBeCloseTo(4);
  });

  it('最小の取り分より小さくしない（カラムが消えて戻せなくなる）', () => {
    const next = nextFlex({ ...base, deltaPx: -100000 });

    expect(next.left).toBeCloseTo(0.2);
    expect(next.right).toBeCloseTo(3.8);
  });

  it('隣も最小を下回らせない', () => {
    const next = nextFlex({ ...base, deltaPx: 100000 });

    expect(next.right).toBeCloseTo(0.2);
    expect(next.left).toBeCloseTo(3.8);
  });

  it('幅が測れない（0）なら、動かさない', () => {
    const next = nextFlex({ ...base, containerPx: 0, deltaPx: 100 });

    expect(next).toEqual({ left: 1, right: 3 });
  });
});

describe('installColumnResizers', () => {
  let root: HTMLElement;

  const flexOf = (id: string): number =>
    Number(
      root
        .querySelector<HTMLElement>(`[data-column-id="${id}"]`)
        ?.style.getPropertyValue('--column-flex'),
    );

  const drag = (index: number, deltaPx: number): void => {
    const handle = [...root.querySelectorAll<HTMLElement>('.column-resizer')][index]!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + deltaPx, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  };

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
    installColumnResizers(root, { containerWidth: () => 1000 });
  });

  it('カラムの間に区切りが入る（3 カラムなら 2 本）', () => {
    expect(root.querySelectorAll('.column-resizer')).toHaveLength(COLUMNS.length - 1);
  });

  it('区切りは、掴めるものとして印される', () => {
    const handle = root.querySelector('.column-resizer');

    expect(handle?.getAttribute('role')).toBe('separator');
    expect(handle?.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('ドラッグすると、左右のカラムの取り分が移る', () => {
    drag(0, 100);

    expect(flexOf('cases')).toBeGreaterThan(1);
    expect(flexOf('live')).toBeLessThan(3);
    expect(flexOf('verdict')).toBe(1);
  });

  it('離した後は、マウスを動かしても変わらない', () => {
    drag(0, 100);
    const after = flexOf('cases');

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900, bubbles: true }));

    expect(flexOf('cases')).toBe(after);
  });

  it('ダブルクリックで、初期位置に戻る', () => {
    drag(0, 200);
    expect(flexOf('cases')).not.toBe(1);

    root
      .querySelector('.column-resizer')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(flexOf('cases')).toBe(1);
    expect(flexOf('live')).toBe(3);
    expect(flexOf('verdict')).toBe(1);
  });

  it('外すと、区切りが消えて、ドラッグも効かなくなる', () => {
    const uninstall = installColumnResizers(root, { containerWidth: () => 1000 });
    uninstall();

    expect(root.querySelectorAll('.column-resizer')).toHaveLength(COLUMNS.length - 1);
  });
});
