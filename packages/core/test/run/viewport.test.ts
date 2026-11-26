import { describe, expect, it } from 'vitest';

import {
  VIEWPORT_KEY,
  parseViewports,
  sheetViewports,
  viewportLabel,
} from '../../src/run/viewport.js';

/**
 * **ページの表示領域の大きさを、シートが決める**（2026-11-26・C122）。
 *
 * ウェブの実行は 1280x900 の窓で固定だった。**利用者の大半がスマホのサイトでは、
 * 主な画面が検証から漏れる。**窓の大きさではなく表示領域（viewport）そのものを
 * 合わせる —— 窓で 390 を作ろうとすると、ブラウザの最小幅で止まる。
 *
 * **`# 待つ:` と同じ考え方で、シートの見出しに書く**（証跡の `sha256` から復元できる・C40）。
 */
describe('parseViewports — 「390x844, 1440x900」を読む', () => {
  it('1 つ', () => {
    expect(parseViewports('390x844')).toEqual([{ width: 390, height: 844 }]);
  });

  it('読点・カンマ・空白で区切って複数', () => {
    expect(parseViewports('390x844, 1440x900')).toEqual([
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]);
    expect(parseViewports('390x844、1440x900')).toEqual([
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]);
  });

  /** 人は `×` や全角で書く。**書き方の違いで止めない。** */
  it('× と全角の数字も読む', () => {
    expect(parseViewports('390×844')).toEqual([{ width: 390, height: 844 }]);
    expect(parseViewports('３９０ｘ８４４')).toEqual([{ width: 390, height: 844 }]);
  });

  /**
   * **読めないものは投げる**（C20）。黙って既定に落とすと、
   * 「390 で見るつもりで 1280 だった」が起きて、**それがいちばん気づけない。**
   */
  it('読めない書き方は投げる（黙って既定に落とさない）', () => {
    expect(() => parseViewports('スマホ')).toThrow(/画面/);
    expect(() => parseViewports('390')).toThrow(/390x844/);
    expect(() => parseViewports('390x')).toThrow(/画面/);
    expect(() => parseViewports('')).toThrow(/画面/);
  });

  /** 打ち間違い（`39x844`・`3900x844`）で見当違いの大きさにしない。 */
  it('小さすぎ・大きすぎは投げる', () => {
    expect(() => parseViewports('39x844')).toThrow(/200/);
    expect(() => parseViewports('390x8440')).toThrow(/7680/);
  });

  /** 同じ大きさを 2 回回しても、証跡が 2 つ出るだけで意味が無い。 */
  it('同じ大きさが 2 回あれば投げる', () => {
    expect(() => parseViewports('390x844, 390x844')).toThrow(/2 回/);
  });
});

describe('sheetViewports — 見出し「# 画面:」', () => {
  it('書いてあれば読む', () => {
    expect(sheetViewports({ [VIEWPORT_KEY]: '390x844' })).toEqual([{ width: 390, height: 844 }]);
  });

  /** **既存のシートは 1 文字も変えずに動く。**無ければ今までどおり。 */
  it('無ければ undefined（既定のまま）', () => {
    expect(sheetViewports({})).toBeUndefined();
    expect(sheetViewports({ [VIEWPORT_KEY]: '   ' })).toBeUndefined();
  });

  it('見出しの名前は「画面」', () => {
    expect(VIEWPORT_KEY).toBe('画面');
  });
});

describe('viewportLabel — 証跡のフォルダ名・画面に出す形', () => {
  it('390x844', () => {
    expect(viewportLabel({ width: 390, height: 844 })).toBe('390x844');
  });
});
