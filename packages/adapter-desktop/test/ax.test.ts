import { describe, expect, it } from 'vitest';

import { axScript, findInElements, parseElements } from '../src/ax.js';

/**
 * 触れ方の**段 1** —— アクセシビリティ（C55）。
 *
 * 名前で触れるので、シートに「「保存」をクリックする」とそのまま書ける。
 * **段 1 が空でも諦めない。**その先は絵から文字を読む（`ocr.ts`）。
 */

describe('axScript', () => {
  it('アプリ名をそのまま埋め込まない（引用符を閉じられると別の命令になる）', () => {
    expect(axScript('ev"il')).toContain(JSON.stringify('ev"il'));
    expect(axScript('ev"il')).not.toContain('"ev"il"');
  });

  it('位置と大きさも一緒に取る（触る場所を決めるのに要る）', () => {
    const script = axScript('メモ');

    expect(script).toContain('position');
    expect(script).toContain('size');
  });
});

describe('parseElements', () => {
  const line = (...parts: (string | number)[]): string => parts.join('\t');

  it('1 行 1 要素として読む', () => {
    const stdout = [
      line('AXButton', '保存', 100, 200, 80, 30),
      line('AXStaticText', '保存しました', 10, 20, 200, 20),
    ].join('\n');

    expect(parseElements(stdout)).toEqual([
      { role: 'AXButton', name: '保存', x: 100, y: 200, width: 80, height: 30 },
      { role: 'AXStaticText', name: '保存しました', x: 10, y: 20, width: 200, height: 20 },
    ]);
  });

  it('欠けた行は捨てる（半端な値で触らない）', () => {
    expect(parseElements('AXButton\t保存\t100')).toEqual([]);
    expect(parseElements('')).toEqual([]);
  });

  it('名前の無い要素は捨てる（名前で触るための一覧なので）', () => {
    expect(parseElements(line('AXGroup', '', 0, 0, 10, 10))).toEqual([]);
  });

  /** **見えない要素は触らない。**大きさが無いものを押しても何も起きない。 */
  it('大きさの無い要素は捨てる', () => {
    expect(parseElements(line('AXButton', '保存', 10, 10, 0, 0))).toEqual([]);
  });
});

describe('findInElements', () => {
  const elements = [
    { role: 'AXGroup', name: '保存の欄', x: 0, y: 0, width: 300, height: 100 },
    { role: 'AXButton', name: '保存', x: 100, y: 200, width: 80, height: 30 },
    { role: 'AXStaticText', name: '保存しました', x: 10, y: 300, width: 200, height: 20 },
  ];

  /**
   * 真ん中と、**その大きさ**を返す。
   * 大きさは、指す矢印をその外へ置くのに要る（2026-09-08・要望シート No.1）。
   */
  it('完全に一致するものを先に選ぶ', () => {
    expect(findInElements(elements, '保存')).toEqual({ x: 140, y: 215, width: 80, height: 30 });
  });

  it('完全一致が無ければ、含むもののうち小さいほうを選ぶ', () => {
    // **大きい親を押すと、別の所が反応する。**
    expect(findInElements(elements, '保存し')).toEqual({
      x: 110,
      y: 310,
      width: 200,
      height: 20,
    });
  });

  it('見つからなければ undefined（次の段へ降りるため）', () => {
    expect(findInElements(elements, '削除')).toBeUndefined();
    expect(findInElements([], '保存')).toBeUndefined();
  });
});
