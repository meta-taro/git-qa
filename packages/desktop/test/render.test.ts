// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { COLUMNS } from '../src/columns.js';
import { setLocale, t } from '../src/i18n/current.js';
import { renderColumns, updateColumnTexts } from '../src/render.js';

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
      const column = COLUMNS[index];
      expect(section.querySelector('.column-heading')?.textContent).toBe(t(column!.headingKey));
      expect(section.querySelector('.column-placeholder')?.textContent).toBe(
        t(column!.placeholderKey),
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
    renderColumns(root, [
      {
        id: 'live',
        headingKey: 'column.verdict.heading',
        placeholderKey: 'column.verdict.placeholder',
        flex: 2,
      },
    ]);

    const [only] = columnsIn(root);
    expect(columnsIn(root)).toHaveLength(1);
    expect(only?.dataset['columnId']).toBe('live');
    expect(only?.style.getPropertyValue('--column-flex')).toBe('2');
  });
});

describe('updateColumnTexts — 言語を切り替えたときに文言だけ差し替える', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
  });

  it('見出しと説明を、いまの言語で書き直す', () => {
    renderColumns(root);
    setLocale('en');
    try {
      updateColumnTexts(root);

      expect(root.querySelector('.column-heading')?.textContent).toBe(t('column.cases.heading'));
    } finally {
      setLocale('ja');
    }
  });

  it('カラムの中身は作り直さない（映像の canvas を消さない）', () => {
    renderColumns(root);
    const live = root.querySelector<HTMLElement>('[data-column-id="live"]')!;
    const canvas = document.createElement('canvas');
    canvas.className = 'live-canvas';
    live.append(canvas);

    updateColumnTexts(root);

    // **描き直すと映像が消える。**言語の切り替えで、見ている映像を落とさない。
    expect(live.querySelector('.live-canvas')).toBe(canvas);
  });
});
