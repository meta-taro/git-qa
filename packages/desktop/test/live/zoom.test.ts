import { describe, expect, it } from 'vitest';

import { ZOOM_STEPS, nextZoom, zoomTransform } from '../../src/live/zoom.js';

/**
 * **判定を置くのは人なのに、判定に必要な文字が読めない**（外部レビュー meta-taro/git-qa#13）。
 *
 * > 相手の状態表示は 12〜13px で描かれているので、59% では **7px 前後**になります。
 * > 見えない画面で押す `D` は、**AI の判定を追認しただけ**になりかねません。
 * > `AUTO_PASS` と `VERIFIED` を型で分けている意味が、ここで薄まります。
 *
 * **この製品の値打ちは「人が見て署名した」こと**なので、見えないなら署名が空になる。
 *
 * 寄る先は **AI が指した場所**にする。git-qa はそこを知っている（要望シート No.1 の矢印）ので、
 * **人が探して動かす手間を作らない。**
 */

/**
 * **映像は枠の中央に置かれている**（親が中央へ寄せる）ので、
 * ここで出すのは**はみ出したぶんをどう寄せるか**だけ。
 */
const frame = { width: 760, height: 700 };
const image = { width: 760, height: 475 };

describe('zoomTransform', () => {
  it('等倍なら、動かさない', () => {
    expect(zoomTransform({ frame, image, scale: 1 })).toEqual({
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
  });

  /** **指した場所を真ん中へ。**人が探して動かす手間を作らない。 */
  it('指した場所が真ん中へ来る', () => {
    // 端に寄りすぎていない所（端だと、寄せると空白が出るので寄せない）。
    const at = { x: 380, y: 237 };
    const view = zoomTransform({ frame, image, scale: 2, focus: at });

    // 拡大後の座標が、枠の中心に来ていること。
    expect(at.x * view.scale + view.translateX).toBeCloseTo(frame.width / 2, 0);
    expect(at.y * view.scale + view.translateY).toBeCloseTo(frame.height / 2, 0);
  });

  /**
   * **端の外は見せない。**寄った先が端に近いと、空白だけが映ることになる。
   * 見えない画面で判定させないための変更なので、**空白を見せては意味がない。**
   */
  it('端へ寄っても、空白を見せない', () => {
    const view = zoomTransform({ frame, image, scale: 2, focus: { x: 5, y: 5 } });

    expect(view.translateX).toBeLessThanOrEqual(0);
    expect(view.translateY).toBeLessThanOrEqual(0);
  });

  it('反対の端でも、空白を見せない', () => {
    const view = zoomTransform({ frame, image, scale: 2, focus: { x: 755, y: 470 } });

    expect(image.width * view.scale + view.translateX).toBeGreaterThanOrEqual(frame.width);
    expect(image.height * view.scale + view.translateY).toBeGreaterThanOrEqual(frame.height);
  });

  /** 指した場所が無ければ、**真ん中へ寄る。** */
  it('指した場所が無ければ、真ん中', () => {
    const view = zoomTransform({ frame, image, scale: 2 });
    const centered = zoomTransform({
      frame,
      image,
      scale: 2,
      focus: { x: image.width / 2, y: image.height / 2 },
    });

    expect(view).toEqual(centered);
  });

  /**
   * **入り切る向きは動かさない。**親が中央へ寄せているので、そこへ足すと二重にずれる。
   * 縦は元から余っている（横長の相手だと、枠の上下が空く）。
   */
  it('入り切る向きは動かさない', () => {
    const view = zoomTransform({ frame, image, scale: 1.2, focus: { x: 700, y: 400 } });

    // 高さ 475 × 1.2 = 570 < 700 なので、縦は動かす必要が無い。
    expect(view.translateY).toBe(0);
  });
});

describe('nextZoom', () => {
  it('段で上げ下げする', () => {
    expect(nextZoom(1, 1)).toBe(ZOOM_STEPS[1]);
    expect(nextZoom(ZOOM_STEPS[1] as number, -1)).toBe(1);
  });

  /** **端で止まる。**押し続けて、見えないほど拡大させない。 */
  it('端では止まる', () => {
    const last = ZOOM_STEPS[ZOOM_STEPS.length - 1] as number;

    expect(nextZoom(last, 1)).toBe(last);
    expect(nextZoom(1, -1)).toBe(1);
  });
});
