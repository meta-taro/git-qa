import { describe, expect, it } from 'vitest';

import { findElementScript, missingElementMessage, parseFoundPoint } from '../src/find.js';

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

/**
 * **名乗りの部分一致**（外部レビュー meta-taro/git-qa#28）。
 *
 * > **画面に文字が出ていない部品は、`aria-label` でしか指せない。**
 * > そしてその `aria-label` は、たいてい**合成された 1 本の文字列**になっている。
 * >
 * >     aria-label="2026-09-20 定休日"
 *
 * 「定休日」で指しても当たらない。`labels.includes(want)` は**配列の要素が丸ごと一致**するかで、
 * 文字列の部分一致ではないため。`innerText` は空（日付の数字しか出ていない）ので
 * 読める文字の側にも掛からない。
 *
 * **シートの書き手から見ると、この 2 行は同じ書き方をしている。**
 * 片方だけ落ちて、ログからは「そんな要素は無い」としか読めない —— **実物には在る。**
 * 無人で流す前提だと、**製品の不具合と区別が付かない FAIL** になる。
 */
describe('findElementScript — 名乗りの部分一致（#28）', () => {
  it('名乗りに含まれるものも探す', () => {
    const script = findElementScript('定休日');

    // 4 段目が在ること（読める文字だけでなく、名乗りにも部分一致を掛ける）。
    expect(script).toContain('labels.some');
  });

  /** **並べ方は 3 段目と同じ。**内側・小さいほうを選ぶ（親を押すと別の所が反応する）。 */
  it('内側の小さいものを選ぶ並べ方は、読める文字のときと同じ', () => {
    const script = findElementScript('定休日');
    const fourth = script.slice(script.indexOf('labels.some'));

    expect(fourth).toContain('children - b.children');
    expect(fourth).toContain('box.width * a.box.height');
  });
});

/**
 * **見つからなかったときに、どこを探したかを言う**（外部レビュー meta-taro/git-qa#28）。
 *
 * > 落ちたログからは「そんな要素は無い」としか読めない。**実物には在る。**
 *
 * 4 段目（名乗りの部分一致）を足しても、**当たらないものは当たらない。**
 * そのときに「そんな要素は無い」とだけ言うと、**実物を見ている人と食い違う。**
 * **探した所を言えば、次に見る場所が決まる。**
 */
describe('missingElementMessage（#28）', () => {
  it('どこを探したかを言う', () => {
    const said = missingElementMessage('定休日');

    expect(said).toContain('定休日');
    expect(said).toContain('読める文字');
    expect(said).toContain('名乗り');
  });

  /** **画面に出ていない文字は、名乗りにしか無い**ことを、その場で示す。 */
  it('名乗りにしか無い場合が在ることを言う', () => {
    expect(missingElementMessage('定休日')).toContain('aria-label');
  });
});
