import { describe, expect, it } from 'vitest';

import {
  ZOOM_STEPS,
  nextZoom,
  sourcePixelRatio,
  zoomForPixels,
  zoomTransform,
} from '../../src/live/zoom.js';

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
 * **枠の中に、絵が中央に置かれている**（`object-fit: contain`）。
 *
 * ここで出すのは**枠（＝ canvas の箱）の中での移動量**。**絵の箱ではない。**
 *
 * ## 2026-09-15 に、ここの模型が間違っていると分かった（外部レビュー meta-taro/git-qa#16）
 *
 * 前は「絵は枠いっぱいに描かれていて、余ったぶんは親が中央へ寄せる」という模型だった。
 * **`object-fit: contain` は、まさにそうならないための指定。**比が違えば必ず余白が出る。
 *
 * > 映像の枠（.live-canvas の箱）  803 x 730
 * > 実際に描かれている絵           803 x 502   ← 比 1.6 を保つので上下に余白
 *
 * **228px は絵ではない。**そこを絵として扱って拡大していたので、
 * 寄る先がずれ、映像が枠の下へはみ出し、中身の無い帯が出た。
 *
 * だから `image` は**枠の中で絵が占めている矩形**を受け取る（左上の位置つき）。
 */
const frame = { width: 760, height: 700 };
/** 760x475 の絵が、上下 112.5px の余白を持って中央に置かれている。 */
const image = { left: 0, top: 112.5, width: 760, height: 475 };

/** 絵の左上が、拡大後に枠のどこへ来るか。 */
const imageAt = (
  view: { scale: number; translateX: number; translateY: number },
  rect = image,
): { left: number; top: number; right: number; bottom: number } => ({
  left: rect.left * view.scale + view.translateX,
  top: rect.top * view.scale + view.translateY,
  right: (rect.left + rect.width) * view.scale + view.translateX,
  bottom: (rect.top + rect.height) * view.scale + view.translateY,
});

describe('zoomTransform', () => {
  it('等倍なら、絵はいまの場所のまま', () => {
    const view = zoomTransform({ frame, image, scale: 1 });

    expect(view).toEqual({ scale: 1, translateX: 0, translateY: 0 });
  });

  /** **指した場所を真ん中へ。**人が探して動かす手間を作らない。 */
  it('指した場所が真ん中へ来る', () => {
    // 絵の中の座標（枠の中の座標ではない）。
    const at = { x: 380, y: 237 };
    const view = zoomTransform({ frame, image, scale: 2, focus: at });

    expect((image.left + at.x) * view.scale + view.translateX).toBeCloseTo(frame.width / 2, 0);
    expect((image.top + at.y) * view.scale + view.translateY).toBeCloseTo(frame.height / 2, 0);
  });

  /**
   * **端の外は見せない。**寄った先が端に近いと、空白だけが映ることになる。
   * 見えない画面で判定させないための変更なので、**空白を見せては意味がない。**
   */
  it('端へ寄っても、空白を見せない', () => {
    const at = imageAt(zoomTransform({ frame, image, scale: 2, focus: { x: 5, y: 5 } }));

    expect(at.left).toBeLessThanOrEqual(0);
    expect(at.top).toBeLessThanOrEqual(0);
  });

  it('反対の端でも、空白を見せない', () => {
    const at = imageAt(zoomTransform({ frame, image, scale: 2, focus: { x: 755, y: 470 } }));

    expect(at.right).toBeGreaterThanOrEqual(frame.width);
    expect(at.bottom).toBeGreaterThanOrEqual(frame.height);
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
   * **入り切る向きは、真ん中に置く。**片側へ寄せると、そちらだけに帯が出る。
   * 縦は元から余っている（横長の相手だと、枠の上下が空く）。
   */
  it('入り切る向きは、真ん中に置く', () => {
    const view = zoomTransform({ frame, image, scale: 1.2, focus: { x: 700, y: 400 } });
    const at = imageAt(view);

    // 高さ 475 × 1.2 = 570 < 700 なので、上下に同じだけ余白が残る。
    expect(at.top).toBeCloseTo((frame.height - image.height * 1.2) / 2, 0);
    expect(frame.height - at.bottom).toBeCloseTo(at.top, 0);
  });

  /**
   * **#16 の実測をそのまま置く。**枠 803x730、相手の窓 1280x800（比 1.6）。
   *
   * > 絵が窓の下端（y=888）まで伸び、説明文「ここから押すのは…」の上に重なって読めない
   * > 下半分（y≈520〜888）に中身が無い。拡大された余白
   */
  it('報告された枠と相手で、絵が枠の外へ出ない', () => {
    const shown = { width: 803, height: 730 };
    const fit = Math.min(shown.width / 1280, shown.height / 800);
    const drawn = {
      left: (shown.width - 1280 * fit) / 2,
      top: (shown.height - 800 * fit) / 2,
      width: 1280 * fit,
      height: 800 * fit,
    };
    // 実測に合っていること（絵は 803x502・上下の余白は約 114px）。
    expect(Math.round(drawn.height)).toBe(502);
    expect(Math.round(drawn.top)).toBe(114);

    const view = zoomTransform({ frame: shown, image: drawn, scale: 2, focus: { x: 40, y: 30 } });
    const at = imageAt(view, drawn);

    // **枠を覆っていて、しかも枠の外に空白が残らない。**
    expect(at.left).toBeLessThanOrEqual(0);
    expect(at.top).toBeLessThanOrEqual(0);
    expect(at.right).toBeGreaterThanOrEqual(shown.width);
    expect(at.bottom).toBeGreaterThanOrEqual(shown.height);
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

/**
 * **拡大しても、細部は増えないことがある**（外部レビュー meta-taro/git-qa#17）。
 *
 * > こちらの画面は 1920x1080 の等倍です。Retina ではありません。
 * > **拡大して出せる細部が、そもそも存在しません。**
 * > 1:1 を超えたら、そう言う。「ここから先は引き伸ばしなので、細部は増えません」と
 * > 画面が言えると、人は無駄に押さずに済みます。**いまは押せてしまうので
 * > 「効かない道具」に見えます。**
 *
 * 数えるのは「**相手の 1 画素が、画面の何画素で出ているか**」。
 * 1 を超えたら、そこから先は引き伸ばし。
 */
describe('sourcePixelRatio — 相手の 1 画素が、画面の何画素になっているか', () => {
  /** 等倍の画面（Retina でない）で、枠が相手より小さい —— 報告と同じ条件。 */
  it('縮んで出ているなら 1 を下回る', () => {
    const ratio = sourcePixelRatio({
      shownWidth: 803,
      sourceWidth: 1280,
      devicePixelRatio: 1,
      scale: 1,
    });

    expect(ratio).toBeCloseTo(0.63, 2);
  });

  it('拡大すると、そのぶん増える', () => {
    const ratio = sourcePixelRatio({
      shownWidth: 803,
      sourceWidth: 1280,
      devicePixelRatio: 1,
      scale: 2,
    });

    expect(ratio).toBeCloseTo(1.25, 2);
  });

  /** **Retina では、同じ見かけでも 2 倍の画素で出ている。**そこを混ぜない。 */
  it('画面の細かさを数に入れる', () => {
    const ratio = sourcePixelRatio({
      shownWidth: 803,
      sourceWidth: 1280,
      devicePixelRatio: 2,
      scale: 1,
    });

    expect(ratio).toBeCloseTo(1.25, 2);
  });

  it('測れないなら、言わない（0 を返さない）', () => {
    expect(
      sourcePixelRatio({ shownWidth: 0, sourceWidth: 1280, devicePixelRatio: 1, scale: 1 }),
    ).toBeUndefined();
    expect(
      sourcePixelRatio({ shownWidth: 803, sourceWidth: 0, devicePixelRatio: 1, scale: 1 }),
    ).toBeUndefined();
  });
});

/**
 * **「相手の画素と 1 対 1」を狙える口**（外部レビュー #17 の提案 2）。
 *
 * > 倍率を上げていく形ではなく、「相手の画素と 1 対 1」を狙えると分かりやすいです。
 * > いまの `0` は「枠に合わせる」なので、別物として要るように思いました。
 */
describe('zoomForPixels — 1 対 1 になる倍率', () => {
  it('その倍率で、ちょうど 1 対 1 になる', () => {
    const scale = zoomForPixels({ shownWidth: 803, sourceWidth: 1280, devicePixelRatio: 1 });

    expect(
      sourcePixelRatio({ shownWidth: 803, sourceWidth: 1280, devicePixelRatio: 1, scale }),
    ).toBeCloseTo(1, 3);
  });

  /** **既に 1 対 1 を超えているなら、下げない。**縮める口ではない。 */
  it('もう足りているなら、等倍のまま', () => {
    const scale = zoomForPixels({ shownWidth: 1600, sourceWidth: 1280, devicePixelRatio: 1 });

    expect(scale).toBe(1);
  });

  it('測れないなら、等倍のまま', () => {
    expect(zoomForPixels({ shownWidth: 0, sourceWidth: 1280, devicePixelRatio: 1 })).toBe(1);
  });
});
