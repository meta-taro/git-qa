import type { Pointing } from '@git-qa/core/session';

import { MAIN_COLUMN_ID } from '../columns.js';
import { screenPoint } from '../session/touch.js';

/**
 * **「ここ、ここ」と指す矢印**（要望シート No.1・2026-09-04）。
 *
 * > ある場所に矢印うにうにしたり、該当箇所四角く案内したりできますかね？
 * > ずっと四角があると、ちゃんとみれないのでゆっくり点滅するとか。
 * > まぁ赤い矢印がここ、ここ🎵みたいにゆれてるほうがいいか。
 *
 * **肝は「ずっと出ていると、ちゃんと見れない」。**
 * 出しっぱなしにせず、指す場所が消えたら消す。**揺らして目を引き、映像は隠さない。**
 */

/**
 * 矢印 1 つが要る余地（映像の中の画素）。**これより端に寄っていたら、斜めにしない。**
 * 矢印を大きくしたので、要る余地も広げた（2026-09-08）。
 */
const ARROW_ROOM = 38;

/**
 * どこを、どの向きから指すか。
 *
 * **斜めから指す**（2026-09-08「斜めから矢印をさしてほしかった」）。左上の角を狙う。
 * ただし**映像の外へはみ出すなら横向きに落とす**（同日「画面外に矢印がでて
 * 見切れてしまうならいまのままでいいです」）。**見切れた矢印は、どこを指しているか
 * 分からない。**
 *
 * 大きさが分からなければ斜めにしない —— **角が分からないので、狙いが定まらない。**
 */
function aimFor(at: Pointing): { x: number; y: number; diagonal: boolean } {
  if (at.width === undefined || at.height === undefined) {
    return { x: at.x, y: at.y, diagonal: false };
  }

  const left = at.x - at.width / 2;
  const top = at.y - at.height / 2;
  const roomAbove = top - ARROW_ROOM >= 0;
  const roomLeft = left - ARROW_ROOM >= 0;

  if (roomAbove && roomLeft) return { x: left, y: top, diagonal: true };
  return { x: left, y: at.y, diagonal: false };
}

/** 指している所を 1 つだけ置く。**同じ所なら置き直さない**（揺れが途切れる）。 */
export function showPointer(root: HTMLElement, at: Pointing | undefined): void {
  const column = root.querySelector<HTMLElement>(`[data-column-id="${MAIN_COLUMN_ID}"]`);
  if (column === null) return;

  const existing = column.querySelector<HTMLElement>('.live-pointer');
  if (at === undefined) {
    existing?.remove();
    return;
  }

  const canvas = column.querySelector<HTMLCanvasElement>('.live-canvas');
  if (canvas === null) return;

  /**
   * **指すものの外へ置く**（2026-09-08「カレンダーならかぶっちゃだめでしょ」）。
   *
   * 座標は指すものの**中心**なので、そこへ矢印の先端を置くと、文字の上に載る。
   * 大きさが分かっているなら**角**へずらす。分からなければ点をそのまま指す
   * （**当て推量で離すと、別のものを指す**）。
   */
  const aim = aimFor(at);

  const on = screenPoint({
    x: aim.x,
    y: aim.y,
    rect: canvas.getBoundingClientRect(),
    canvas: { width: at.screen.x, height: at.screen.y },
  });
  // 測れないなら指さない。**見当違いの所を指すより、指さないほうがよい。**
  if (on === undefined) {
    existing?.remove();
    return;
  }

  const key = `${String(Math.round(aim.x))},${String(Math.round(aim.y))},${at.label ?? ''}`;
  // **同じ所を続けて指すなら、置き直さない。**置き直すと揺れが最初から始まる。
  if (existing !== null && existing.dataset['at'] === key) return;
  existing?.remove();

  const doc = root.ownerDocument;
  const mark = doc.createElement('div');
  mark.className = aim.diagonal ? 'live-pointer is-diagonal' : 'live-pointer';
  mark.dataset['at'] = key;
  // 枠の中の座標へ置く（column を基準にする）。
  const box = column.getBoundingClientRect();
  mark.style.left = `${String(Math.round(on.x - box.left))}px`;
  mark.style.top = `${String(Math.round(on.y - box.top))}px`;

  /**
   * 傾ける層と、揺らす層を分ける。
   * **CSS の animation は transform をまるごと置き換える**ので、
   * 同じ層で傾けて揺らすと、傾きが消える。
   */
  const tilt = doc.createElement('span');
  tilt.className = 'live-pointer-tilt';

  const arrow = doc.createElement('span');
  arrow.className = 'live-pointer-arrow';
  // **矢印は文字で描く。**絵を足すと、色と形の方針（DESIGN.md）を私が先回りして決めることになる。
  arrow.textContent = '➤';
  tilt.append(arrow);
  mark.append(tilt);

  /**
   * **名前の札は置かない**（2026-09-08「矢印はいいけど、赤い一覧はじゃまです」）。
   *
   * 一度は映像の上に札を出したが、**指したい所の手前を札が覆った。**
   * 「ずっと出ていると、ちゃんと見れない」という最初の要望と同じ話だった。
   * 名前（`at.label`）は状態には残してある。**映像の外へ出すなら、そこから使える。**
   */

  column.append(mark);
}
