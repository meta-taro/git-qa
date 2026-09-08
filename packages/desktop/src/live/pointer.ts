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

  const on = screenPoint({
    x: at.x,
    y: at.y,
    rect: canvas.getBoundingClientRect(),
    canvas: { width: at.screen.x, height: at.screen.y },
  });
  // 測れないなら指さない。**見当違いの所を指すより、指さないほうがよい。**
  if (on === undefined) {
    existing?.remove();
    return;
  }

  const key = `${String(Math.round(at.x))},${String(Math.round(at.y))},${at.label ?? ''}`;
  // **同じ所を続けて指すなら、置き直さない。**置き直すと揺れが最初から始まる。
  if (existing !== null && existing.dataset['at'] === key) return;
  existing?.remove();

  const doc = root.ownerDocument;
  const mark = doc.createElement('div');
  mark.className = 'live-pointer';
  mark.dataset['at'] = key;
  // 枠の中の座標へ置く（column を基準にする）。
  const box = column.getBoundingClientRect();
  mark.style.left = `${String(Math.round(on.x - box.left))}px`;
  mark.style.top = `${String(Math.round(on.y - box.top))}px`;

  const arrow = doc.createElement('span');
  arrow.className = 'live-pointer-arrow';
  // **矢印は文字で描く。**絵を足すと、色と形の方針（DESIGN.md）を私が先回りして決めることになる。
  arrow.textContent = '➤';
  mark.append(arrow);

  if (at.label !== undefined && at.label !== '') {
    const label = doc.createElement('span');
    label.className = 'live-pointer-label';
    // **矢印だけだと、何の話か分からない。**指しているものの名前を添える。
    label.textContent = at.label;
    mark.append(label);
  }

  column.append(mark);
}
