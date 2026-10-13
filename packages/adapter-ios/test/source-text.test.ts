import { describe, expect, it } from 'vitest';

import { pickByText, sourceToLines } from '../src/wda.js';

/**
 * **絵から読む道具が無くても、口（WDA）から画面の文字を読む**（2026-10-13・Windows の席で踏んだ）。
 *
 * 絵から読む道具（`git-qa-ocr`）は macOS の Vision で、Windows には無い。
 * 無いと「文字が読めない」ので、AI は押す所を探せず BLOCKED、判定は FAIL になっていた。
 * WDA は画面の部品の名前と位置（ポイント）を返す。**絵から読んだ文字と同じ形**
 * （`文字 \t x \t y \t 幅 \t 高さ`・画素・x / y は真ん中）に直して、同じ道で使う。
 */
const tree = {
  type: 'Application',
  label: '設定',
  isVisible: '1',
  rect: { x: 0, y: 0, width: 375, height: 812 },
  children: [
    {
      type: 'NavigationBar',
      label: '一般',
      isVisible: '1',
      rect: { x: 0, y: 44, width: 375, height: 52 },
      children: [],
    },
    {
      type: 'Cell',
      label: '情報',
      isVisible: '1',
      rect: { x: 16, y: 200, width: 343, height: 44 },
      children: [
        {
          type: 'StaticText',
          label: '情報',
          isVisible: '1',
          rect: { x: 60, y: 210, width: 40, height: 24 },
        },
      ],
    },
    {
      type: 'StaticText',
      label: '画面の外',
      isVisible: '0',
      rect: { x: 60, y: 2000, width: 40, height: 24 },
    },
    { type: 'StaticText', label: '', isVisible: '1', rect: { x: 1, y: 1, width: 1, height: 1 } },
  ],
};

describe('sourceToLines', () => {
  it('見えている部品の名前を、画素の真ん中の座標で並べる', () => {
    const lines = sourceToLines(tree, 3).split('\n');
    expect(lines).toContain(
      `一般\t${String(187.5 * 3)}\t${String(70 * 3)}\t${String(375 * 3)}\t${String(52 * 3)}`,
    );
    expect(lines).toContain(
      `情報\t${String(80 * 3)}\t${String(222 * 3)}\t${String(40 * 3)}\t${String(24 * 3)}`,
    );
  });

  it('見えていない部品と、名前の無い部品は入れない', () => {
    const said = sourceToLines(tree, 3);
    expect(said).not.toContain('画面の外');
    expect(said.split('\n').every((line) => !line.startsWith('\t'))).toBe(true);
  });

  it('アプリそのもの（画面全体）は入れない', () => {
    expect(
      sourceToLines(tree, 3)
        .split('\n')
        .some((line) => line.startsWith('設定\t')),
    ).toBe(false);
  });

  it('同じ名前が重なるなら、押す所はいちばん小さい部品（文字そのもの）になる', () => {
    const found = pickByText(sourceToLines(tree, 3), '情報');
    expect(found).toEqual({ x: 80 * 3, y: 222 * 3, width: 40 * 3, height: 24 * 3 });
  });

  it('isVisible が真偽値でも読める', () => {
    const said = sourceToLines(
      {
        type: 'StaticText',
        label: '開始',
        isVisible: true,
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
      2,
    );
    expect(said).toBe('開始\t10\t10\t20\t20');
  });
});
