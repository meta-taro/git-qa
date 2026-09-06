import { describe, expect, it } from 'vitest';

import { findElementScript, parseFoundPoint } from '../src/find.js';

/**
 * 画面の文字から、触る場所を決める（Issue 015）。
 *
 * 実物の検証シートは「**「保存」をクリックする**」と書く。座標では書かない。
 * 2026-09-06、見本のシートが 3 件目でここに当たって止まった:
 * `ウェブではまだ座標でしか触れない（来たもの: element）`
 */

describe('findElementScript', () => {
  it('探す文字をそのまま埋め込まない（引用符を閉じられると別の命令になる）', () => {
    // product-baseline §21。ページの中で走らせる文なので、閉じられると何でもできる。
    const script = findElementScript('ev"il');

    expect(script).not.toContain('"ev"il"');
    expect(script).toContain(JSON.stringify('ev"il'));
  });

  it('日本語の文字も落とさない（実物のシートは日本語で書かれている）', () => {
    expect(findElementScript('保存')).toContain(JSON.stringify('保存'));
  });

  it('見えているものだけを見る（隠れた要素を押さない）', () => {
    // `display: none` の要素を押すと、何も起きないのに「押した」ことになる。
    const script = findElementScript('保存');

    expect(script).toContain('getBoundingClientRect');
  });

  it('文字以外の名乗りも見る（aria-label / placeholder / value / title）', () => {
    const script = findElementScript('保存');

    for (const name of ['aria-label', 'placeholder', 'value', 'title']) {
      expect(script).toContain(name);
    }
  });
});

describe('parseFoundPoint', () => {
  it('見つかった位置を読む', () => {
    expect(parseFoundPoint({ x: 12.4, y: 34.6 })).toEqual({ x: 12, y: 35 });
  });

  it('見つからなければ undefined（当て推量で触らない）', () => {
    expect(parseFoundPoint(null)).toBeUndefined();
    expect(parseFoundPoint(undefined)).toBeUndefined();
    expect(parseFoundPoint({})).toBeUndefined();
    expect(parseFoundPoint({ x: 1 })).toBeUndefined();
    expect(parseFoundPoint('12,34')).toBeUndefined();
  });
});
