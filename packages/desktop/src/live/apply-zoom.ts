import { MAIN_COLUMN_ID } from '../columns.js';
import { showPointer } from './pointer.js';
import { zoomTransform } from './zoom.js';
import type { Pointing } from '@git-qa/core/session';

/**
 * 拡大を映像へ当てる（外部レビュー meta-taro/git-qa#13）。
 *
 * **寄る先は AI が指した場所。**git-qa はそこを知っている（要望シート No.1 の矢印）ので、
 * **人が探して動かす手間を作らない。**指していなければ真ん中。
 *
 * ## 2026-09-15、押すと 3 つ同時に崩れていた（外部レビュー meta-taro/git-qa#16）
 *
 * > 映像が枠の下へはみ出す／中身の無い黒帯が出る／**矢印が 424px ずれて何も無い所を指す**
 *
 * 原因は 2 つ。
 *
 * 1. **絵は枠いっぱいに描かれている、と思っていた。**`object-fit: contain` は
 *    まさにそうしないための指定で、比が違えば必ず余白が出る（実測 803x730 の箱に絵は 803x502）
 * 2. **矢印を、映像と同じ移動量で動かしていた。**原点が別の要素なので、同じ倍率でも動き方が違う
 *
 * 2 は**別当てをやめた。**矢印を置く `screenPoint` は `contain` を正しく数えているので、
 * **拡大後の枠でもう一度置き直せば足りる**（`getBoundingClientRect` は変形後の箱を返す）。
 * **数える所を 2 つ持たない** —— 2 つ持ったから、片方だけ間違えた。
 */
export function applyZoom(root: HTMLElement, scale: number, at: Pointing | undefined): void {
  const column = root.querySelector<HTMLElement>(`[data-column-id="${MAIN_COLUMN_ID}"]`);
  const canvas = column?.querySelector<HTMLCanvasElement>('.live-canvas');
  if (column === null || column === undefined || canvas === null || canvas === undefined) return;

  // はみ出した分を隠す。**枠の外の絵を、隣の説明文の上に出さない。**
  column.classList.toggle('is-zoomed', scale > 1);

  // **変形を外してから測る。**前の変形が残った箱で数えると、掛け算が積み上がる。
  canvas.style.transform = '';
  const box = canvas.getBoundingClientRect();
  const drawn = drawnImage(box, at);

  const view = zoomTransform({
    frame: { width: box.width, height: box.height },
    image: drawn,
    scale,
    ...(at === undefined
      ? {}
      : {
          focus: { x: (at.x / at.screen.x) * drawn.width, y: (at.y / at.screen.y) * drawn.height },
        }),
  });

  canvas.style.transformOrigin = '0 0';
  canvas.style.transform =
    view.scale === 1
      ? ''
      : `translate(${String(Math.round(view.translateX))}px, ${String(Math.round(view.translateY))}px) scale(${String(view.scale)})`;

  /**
   * **矢印は置き直す。**同じ移動量を当てない（#16）。
   *
   * `showPointer` は**そのときの枠**から画素位置を出す。上で変形を当てたので、
   * `getBoundingClientRect` は**拡大後の箱**を返す —— そこへ `contain` を数え直せば、
   * 矢印は絵の同じ場所に付く。
   */
  showPointer(root, at);
}

/**
 * 枠の中で、実際に絵が描かれている矩形（`object-fit: contain`）。
 *
 * 相手の大きさが分からないときは、**枠いっぱいだと見なす** ——
 * 分からないものを当て推量で狭めると、寄る先がずれる。
 */
function drawnImage(
  box: { width: number; height: number },
  at: Pointing | undefined,
): { left: number; top: number; width: number; height: number } {
  const screen = at?.screen;
  if (screen === undefined || screen.x <= 0 || screen.y <= 0) {
    return { left: 0, top: 0, width: box.width, height: box.height };
  }

  const fit = Math.min(box.width / screen.x, box.height / screen.y);
  const width = screen.x * fit;
  const height = screen.y * fit;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}
