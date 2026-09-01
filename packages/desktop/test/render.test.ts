// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { COLUMNS } from '../src/columns.js';
import { renderColumns } from '../src/render.js';

function columnsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('.column')];
}

describe('renderColumns', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    root.id = 'app';
    document.body.append(root);
  });

  it('3 カラムを構成どおりの順で描く', () => {
    renderColumns(root);

    expect(columnsIn(root).map((section) => section.dataset['columnId'])).toEqual([
      'cases',
      'live',
      'verdict',
    ]);
  });

  it('幅の取り分を CSS へ渡す（CSS 側に数字を書かない）', () => {
    renderColumns(root);

    for (const [index, section] of columnsIn(root).entries()) {
      expect(section.style.getPropertyValue('--column-flex')).toBe(String(COLUMNS[index]?.flex));
    }
  });

  it('見出しと、空であることの説明を出す', () => {
    renderColumns(root);

    for (const [index, section] of columnsIn(root).entries()) {
      expect(section.querySelector('.column-heading')?.textContent).toBe(COLUMNS[index]?.heading);
      expect(section.querySelector('.column-placeholder')?.textContent).toBe(
        COLUMNS[index]?.placeholder,
      );
    }
  });

  /** 骨格の時点では、どのカラムにも中身が無い。ここが増えたら、それは骨格ではない。 */
  it('カラムの中身は見出しと説明の 2 つだけ', () => {
    renderColumns(root);

    for (const section of columnsIn(root)) {
      expect(section.children).toHaveLength(2);
    }
  });

  it('2 回描いてもカラムが増えない', () => {
    renderColumns(root);
    renderColumns(root);

    expect(columnsIn(root)).toHaveLength(COLUMNS.length);
  });

  it('渡した構成のとおりに描く', () => {
    renderColumns(root, [{ id: 'live', heading: '見出し', placeholder: '説明', flex: 2 }]);

    const [only] = columnsIn(root);
    expect(columnsIn(root)).toHaveLength(1);
    expect(only?.dataset['columnId']).toBe('live');
    expect(only?.style.getPropertyValue('--column-flex')).toBe('2');
  });
});
