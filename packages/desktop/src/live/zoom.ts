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
  /** 見えている枠の大きさ。 */
  readonly frame: { readonly width: number; readonly height: number };
  /** 等倍で描かれている映像の大きさ。 */
  readonly image: { readonly width: number; readonly height: number };
  readonly scale: number;
  /** 寄る先（映像の中の座標）。**無ければ真ん中。** */
  readonly focus?: { readonly x: number; readonly y: number };
}

export function zoomTransform(options: ZoomOptions): ZoomView {
  const { frame, image, scale } = options;
  const focus = options.focus ?? { x: image.width / 2, y: image.height / 2 };

  return {
    scale,
    translateX: offset(frame.width, image.width * scale, focus.x * scale),
    translateY: offset(frame.height, image.height * scale, focus.y * scale),
  };
}

/**
 * 1 方向の移動量。**端の外は見せない。**
 *
 * 見えない画面で判定させないための変更なので、**空白を見せては意味がない。**
 * 拡大しても入り切る向きは、真ん中に置いたまま動かさない。
 */
function offset(frameSize: number, scaledSize: number, focusAt: number): number {
  // **入り切る向きは動かさない。**親が中央へ寄せているので、足すと二重にずれる。
  if (scaledSize <= frameSize) return 0;

  const wanted = frameSize / 2 - focusAt;
  // 左（上）へ出しすぎない / 右（下）へ出しすぎない。
  const min = frameSize - scaledSize;
  return Math.min(0, Math.max(min, wanted));
}

/** 段を 1 つ上げ下げする。**端では止まる。** */
export function nextZoom(current: number, direction: 1 | -1): number {
  const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
  const at = index === -1 ? 0 : index;
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, at + direction));
  return ZOOM_STEPS[next] ?? 1;
}
