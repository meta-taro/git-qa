import { describe, expect, it } from 'vitest';

import {
  disabledElementMessage,
  findElementScript,
  foundDisabledOnly,
  missingElementMessage,
  parseFoundPoint,
} from '../src/find.js';

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
  /**
   * **並べ方は 4 段すべて同じ**（#28 で決めたこと）。
   *
   * **2026-09-24 に字面が変わった**（#41）—— 選び方を 1 本（`pick`）にまとめ、
   * **押せるものを先に**する段を足したため。
   * **守っているものは同じ**なので、`pick` を通っていることと、
   * その中が内側・小さいほうで並ぶことを見る。
   */
  it('内側の小さいものを選ぶ並べ方は、読める文字のときと同じ', () => {
    const script = findElementScript('定休日');
    const fourth = script
      .split('\n')
      .find((line) => line.includes('labels.some((v) => v.includes(want))'));

    // 4 段目も、他の段と同じ選び方を通る（押せるものが先・その中で内側・小さいほう）
    expect(fourth).toContain('pick(');
    // その並べ方は、内側・小さいほう（押せるかどうかのあと）
    expect(script).toContain('a.children - b.children');
    expect(script).toContain('a.box.width * a.box.height');
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

/**
 * **押せない見出しに当たっていた**（外部レビュー meta-taro/git-qa#41）。
 *
 * > `Enter キーを押す` → 見つかる ／ `「ログイン」をクリックする` → 見つからない
 *
 * 同じ文字が**カードの見出し**（押せない）と**送信ボタン**（押せる）の 2 箇所にある画面で、
 * **見出しに当たっていた。**押しても何も起きないのに、**手順は成功として記録される。**
 *
 * 2 段目は「いちばん内側」で並べていたが、
 * **見出しもボタンも子を持たなければ `children` は同じ 0** なので、
 * **文書に先に出てくるほう（見出し）が勝っていた。**
 *
 * 「いちばん内側」は**入れ子の話**で、**押せるかどうかの前に置くものではなかった。**
 */
describe('押せるものを先に選ぶ（#41）', () => {
  it('押せる候補を、押せないものより先に見る', () => {
    const script = findElementScript('ログイン');

    // 押せるかどうかを見ている（役割・タグ・無効の状態）
    expect(script).toMatch(/button/i);
    expect(script).toMatch(/role/i);
  });

  it('押せない状態のものは候補から外す（押していないのに成功にしない）', () => {
    const script = findElementScript('ログイン');

    expect(script).toMatch(/disabled/);
    expect(script).toMatch(/pointer-events|pointerEvents/);
  });

  /**
   * **「見つからない」と「見つかったが押せない」を混ぜない**（C20）。
   * 混ぜると、**シートの書き方が悪いのか、画面がその状態なのか**が分からない。
   */
  /**
   * **押せるものが「押せない状態」なら、見出しへ逃げない**（2026-09-24 に実物で踏んだ）。
   *
   * 報告者の画面は**見出し（押せない）＋ ボタン（押せる）**だった。
   * そのボタンが `disabled` のとき、**見出しを押して「成功」にしていた** ——
   * #41 が言っている形そのままを、直した側で作っていた。
   */
  it('押せるものが押せない状態なら、押せない見出しへ落ちない', () => {
    const script = findElementScript('送信');

    // 押せる候補が塞がっていることを、押せない候補より先に見る
    expect(script).toMatch(/pressable[\s\S]*blocked|blocked[\s\S]*pressable/);
    expect(script).toContain('disabledOnly');
  });

  it('押せない状態のものしか無かったときは、そう言える形で返す', () => {
    const script = findElementScript('ログイン');

    expect(script).toContain('disabledOnly');
  });
});

describe('parseFoundPoint（押せない状態のとき）', () => {
  it('押せないものしか無かったことを読み取れる', () => {
    expect(parseFoundPoint({ disabledOnly: true })).toBeUndefined();
    expect(foundDisabledOnly({ disabledOnly: true })).toBe(true);
    expect(foundDisabledOnly({ x: 1, y: 2 })).toBe(false);
    expect(foundDisabledOnly(null)).toBe(false);
  });
});

describe('disabledElementMessage', () => {
  it('何が起きたかと、次に何をすればよいかを言う', () => {
    const said = disabledElementMessage('ログイン');

    expect(said).toContain('ログイン');
    expect(said).toMatch(/押せない状態/);
  });
});

/**
 * **ウェブでも、見る場所を指す**（2026-09-24・人の指示）。
 *
 * > ウェブ側はまだですってのは実装なら実装してください。
 *
 * **ウェブには矢印の口そのものが無かった** —— デスクトップと Android は
 * 「AI が触った場所」を画面へ流していたのに、**ウェブは 1 度も指していなかった。**
 *
 * **囲むには大きさが要る。**中心だけでは枠を描けない
 * （当て推量で広げると、別のものを囲む）。
 */
describe('見つけた所の大きさも返す（2026-09-24）', () => {
  it('探す道が、大きさも返す', () => {
    const script = findElementScript('保存');

    expect(script).toContain('width: box.width');
    expect(script).toContain('height: box.height');
  });

  it('返ってきた大きさを読む', () => {
    expect(parseFoundPoint({ x: 10, y: 20, width: 60, height: 24 })).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 24,
    });
  });

  it('大きさが無くても、場所は読める（古い返りでも落ちない）', () => {
    expect(parseFoundPoint({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });
});
