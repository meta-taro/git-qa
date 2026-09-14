import { describe, expect, it } from 'vitest';

import {
  DEPTH_CUT,
  axScript,
  findInElements,
  missingElementMessage,
  parseElements,
  wasCutOff,
} from '../src/ax.js';

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

/**
 * **WebView を使うアプリは、素の AppKit より 2〜3 段深い**（外部レビュー meta-taro/git-qa#11）。
 *
 * > このアプリの操作できる部品は、全部 深さ 7 にあります。
 * > 窓 → AXGroup → AXScrollArea → AXWebArea → … と潜るので、
 * > 6 は AppKit のアプリなら妥当でも、Tauri / Electron には届きません。
 *
 * 実際、**押したいものが軒並み 1 段外**だった。届いていたのは一覧だけ。
 */
describe('axScript — どこまで潜るか', () => {
  it('WebView のアプリに届く深さまで潜る', () => {
    const depth = Number(/depth > (\d+)/.exec(axScript('x'))?.[1] ?? 0);

    // 実物で測った結果、WebView のアプリは 12 まで要った（素の作りは 9 で足りる）。
    expect(depth).toBeGreaterThanOrEqual(12);
  });

  /**
   * **打ち切ったことを、読む側へ伝える。**
   *
   * > いまの「画面に見つからない要素」は、*無い*のか*届かなかった*のかを区別しません。
   * > 私はこれを「名前が違うのだろう」と読んで、しばらく別の名前を試しました。
   */
  it('打ち切ったら、そう分かる印を出す', () => {
    expect(axScript('x')).toContain(DEPTH_CUT);
  });
});

describe('parseElements — 打ち切りの印', () => {
  it('印があれば、打ち切られたと分かる', () => {
    const said = ['AXButton\t保存\t10\t20\t30\t40', DEPTH_CUT].join('\n');

    expect(wasCutOff(said)).toBe(true);
  });

  it('印が無ければ、最後まで見ている', () => {
    expect(wasCutOff('AXButton\t保存\t10\t20\t30\t40')).toBe(false);
  });

  /** **印そのものは部品ではない。**一覧に混ぜない。 */
  it('印を部品として数えない', () => {
    const said = ['AXButton\t保存\t10\t20\t30\t40', DEPTH_CUT].join('\n');

    expect(parseElements(said)).toHaveLength(1);
  });
});

/**
 * **「無い」と「届かなかった」を分けて言う**（外部レビュー meta-taro/git-qa#11）。
 *
 * > 私はこれを「名前が違うのだろう」と読んで、しばらく別の名前を試しました。
 * > 「深さ 6 まで見て見つからなかった」と出ていれば、すぐ分かりました。
 */
describe('missingElementMessage', () => {
  it('最後まで見て無かったなら、そう言う', () => {
    const said = missingElementMessage('保存', false);

    expect(said).toContain('保存');
    expect(said).not.toContain('深さ');
  });

  it('打ち切っていたら、そう言う', () => {
    const said = missingElementMessage('保存', true);

    expect(said).toContain('深さ');
    // **次に何をすればよいかまで言う。**
    expect(said).toContain('GIT_QA_AX_DEPTH');
  });

  /**
   * **実際に打ち切った深さを言う。**既定値を出すと、環境変数で下げているときに
   * **食い違った数字を人へ見せる**ことになる（2026-09-14・実物で気づいた）。
   */
  it('実際に打ち切った深さを言う', () => {
    expect(missingElementMessage('保存', true, { GIT_QA_AX_DEPTH: '3' })).toContain('深さ 3');
  });
});

/**
 * **部品 1 つずつ聞かない**（2026-09-14・実物で測った）。
 *
 * 1 つの部品につき `name` `description` `value` `position` `size` `role` を
 * 別々に聞いていた。**部品の数だけ 6 往復する。**実物（Tauri アプリ・部品 74 個）で
 * **11.6 秒**かかっていた。コメントには「4 段で 793 ms」と書いてあったが、
 * **深く潜るようにした時点で、そこは当てはまらなくなっていた。**
 *
 * 親ごとにまとめて取ると **7.1 秒**（同じ 76 個）。**往復の数が減る。**
 */
describe('axScript — まとめて取る', () => {
  it('属性を 1 つずつ聞かない', () => {
    const said = axScript('x');

    // まとめ取りの形（`uiElements.name()` など）で聞いていること。
    expect(said).toContain('uiElements.name()');
    expect(said).toContain('uiElements.position()');
  });

  /** **名前が無いものは、説明 → 値の順に見る**（テキスト欄の中身はここに入る）。 */
  it('名前が無ければ、説明と値まで見る', () => {
    const said = axScript('x');

    expect(said).toContain('uiElements.description()');
    expect(said).toContain('uiElements.value()');
  });
});
