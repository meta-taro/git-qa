/**
 * ライブ映像を拡大する（外部レビュー meta-taro/git-qa#13）。
 *
 * > 相手の状態表示は 12〜13px で描かれているので、59% では **7px 前後**になります。
 * > 見えない画面で押す `D` は、**AI の判定を追認しただけ**になりかねません。
 *
 * **この製品の値打ちは「人が見て署名した」こと**なので、見えないなら署名が空になる。
 * `AUTO_PASS` と `VERIFIED` を型で分けている意味が、そこで薄まる。
 *
 * **寄る先は AI が指した場所。**git-qa はそこを知っている（要望シート No.1 の矢印）ので、
 * **人が探して動かす手間を作らない。**指していなければ真ん中。
 */

/** 拡大の段。**押し続けて、見えないほど拡大させない。** */
export const ZOOM_STEPS: readonly number[] = [1, 1.5, 2, 3, 4];

export interface ZoomView {
  readonly scale: number;
  /** 映像へ当てる移動量（画素）。 */
  readonly translateX: number;
  readonly translateY: number;
}

export interface ZoomOptions {
  /** 見えている枠（`.live-canvas` の箱）。**ここから外は見えない。** */
  readonly frame: { readonly width: number; readonly height: number };
  /**
   * 枠の中で、**実際に絵が描かれている矩形。**
   *
   * **枠と同じではない**（外部レビュー meta-taro/git-qa#16）。`object-fit: contain` は
   * 比を保つので、比が違えば必ず余白が出る。実測で、箱 803x730 に対して絵は 803x502 ——
   * **228px は絵ではない。**そこを絵として扱って拡大したので、
   * 寄る先がずれ、映像が枠の外へはみ出し、中身の無い帯が出た。
   */
  readonly image: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly scale: number;
  /** 寄る先（**絵の中**の座標）。**無ければ絵の真ん中。** */
  readonly focus?: { readonly x: number; readonly y: number };
}

export function zoomTransform(options: ZoomOptions): ZoomView {
  const { frame, image, scale } = options;
  const focus = options.focus ?? { x: image.width / 2, y: image.height / 2 };

  return {
    scale,
    translateX: offset(frame.width, image.left, image.width, scale, focus.x),
    translateY: offset(frame.height, image.top, image.height, scale, focus.y),
  };
}

/**
 * 1 方向の移動量。**端の外は見せない。**
 *
 * 見えない画面で判定させないための変更なので、**空白を見せては意味がない。**
 *
 * 拡大は枠（箱）の左上を原点に掛かるので、**絵は `start`（余白）のぶんだけ先に居る。**
 * そこを 0 と見なしていたのが #16 の原因なので、ここで必ず数に入れる。
 */
function offset(
  frameSize: number,
  start: number,
  imageSize: number,
  scale: number,
  focus: number,
): number {
  const scaledStart = start * scale;
  const scaledSize = imageSize * scale;

  // **入り切る向きは、真ん中に置く。**片側へ寄せると、そちらだけに帯が出る。
  if (scaledSize <= frameSize) return (frameSize - scaledSize) / 2 - scaledStart;

  const wanted = frameSize / 2 - (scaledStart + focus * scale);
  // 手前へ出しすぎない / 奥へ出しすぎない（絵で枠を覆ったまま動かす）。
  const most = -scaledStart;
  const least = frameSize - (scaledStart + scaledSize);
  return Math.min(most, Math.max(least, wanted));
}

/** 段を 1 つ上げ下げする。**端では止まる。** */
export function nextZoom(current: number, direction: 1 | -1): number {
  const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
  const at = index === -1 ? 0 : index;
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, at + direction));
  return ZOOM_STEPS[next] ?? 1;
}

/**
 * **相手の 1 画素が、画面の何画素で出ているか**（外部レビュー meta-taro/git-qa#17）。
 *
 * > こちらの画面は 1920x1080 の等倍です。Retina ではありません。
 * > **拡大して出せる細部が、そもそも存在しません。**
 *
 * 1 を超えたら、そこから先は**引き伸ばし** —— 押しても細部は増えない。
 * **それを画面が言えると、人は無駄に押さずに済む。**
 * 言わないと「効かない道具」に見える。
 */
export function sourcePixelRatio(params: {
  /** いま画面に出ている絵の幅（CSS 画素）。 */
  readonly shownWidth: number;
  /** 取り込んだ絵の幅（画素）。**相手の画素数そのもの。** */
  readonly sourceWidth: number;
  /** 画面の細かさ。Retina なら 2。 */
  readonly devicePixelRatio: number;
  readonly scale: number;
}): number | undefined {
  const { shownWidth, sourceWidth, devicePixelRatio, scale } = params;
  // **測れないなら言わない。**当てずっぽうの数を出すくらいなら、黙るほうがよい。
  if (shownWidth <= 0 || sourceWidth <= 0 || devicePixelRatio <= 0) return undefined;

  return (shownWidth * scale * devicePixelRatio) / sourceWidth;
}

/**
 * **「相手の画素と 1 対 1」になる倍率**（外部レビュー #17 の提案 2）。
 *
 * > 倍率を上げていく形ではなく、「相手の画素と 1 対 1」を狙えると分かりやすいです。
 *
 * **縮める口ではない。**もう足りているなら等倍のまま返す
 * （縮めると、せっかく在る細部を捨てることになる）。
 */
export function zoomForPixels(params: {
  readonly shownWidth: number;
  readonly sourceWidth: number;
  readonly devicePixelRatio: number;
}): number {
  const at = sourcePixelRatio({ ...params, scale: 1 });
  if (at === undefined || at >= 1) return 1;
  return 1 / at;
}
