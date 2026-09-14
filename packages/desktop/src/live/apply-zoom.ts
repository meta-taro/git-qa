import { MAIN_COLUMN_ID } from '../columns.js';
import { zoomTransform } from './zoom.js';
import type { Pointing } from '@git-qa/core/session';

/**
 * 拡大を映像へ当てる（外部レビュー meta-taro/git-qa#13）。
 *
 * **寄る先は AI が指した場所。**git-qa はそこを知っている（要望シート No.1 の矢印）ので、
 * **人が探して動かす手間を作らない。**指していなければ真ん中。
 *
 * **矢印も一緒に拡大する。**別々に動かすと、指す先がずれる。
 */
export function applyZoom(root: HTMLElement, scale: number, at: Pointing | undefined): void {
  const column = root.querySelector<HTMLElement>(`[data-column-id="${MAIN_COLUMN_ID}"]`);
  const canvas = column?.querySelector<HTMLCanvasElement>('.live-canvas');
  if (column === null || column === undefined || canvas === null || canvas === undefined) return;

  // はみ出した分を隠す。**空白や、枠の外の絵を見せない。**
  column.classList.toggle('is-zoomed', scale > 1);

  const box = canvas.getBoundingClientRect();
  const view = zoomTransform({
    frame: { width: box.width, height: box.height },
    // 映像は枠いっぱいに描かれている（枠の形に合わせてある）。
    image: { width: box.width, height: box.height },
    scale,
    ...(at === undefined ? {} : { focus: focusIn(at, box) }),
  });

  const transform =
    view.scale === 1
      ? ''
      : `translate(${String(Math.round(view.translateX))}px, ${String(Math.round(view.translateY))}px) scale(${String(view.scale)})`;

  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = transform;

  // **矢印も同じだけ動かす。**別々にすると、指す先がずれる。
  const pointer = column.querySelector<HTMLElement>('.live-pointer');
  if (pointer !== null) {
    pointer.style.transformOrigin = '0 0';
    pointer.style.transform = transform;
  }
}

/** 指された場所を、映像の中の座標へ直す。 */
function focusIn(at: Pointing, box: DOMRect): { x: number; y: number } {
  const screen = at.screen;
  if (screen === undefined || screen.x <= 0 || screen.y <= 0) {
    return { x: box.width / 2, y: box.height / 2 };
  }
  return { x: (at.x / screen.x) * box.width, y: (at.y / screen.y) * box.height };
}
