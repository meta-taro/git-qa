/**
 * 専用カーソルの吹き出しの置き場所と、出しておく時間（C120）。
 *
 * **組み版に依らない計算だけ**をここに置く。happy-dom は組み版をしないので、
 * 窓の中に収まるかは、この関数を数で確かめる。
 */

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
export interface Size {
  readonly width: number;
  readonly height: number;
}
export interface Point {
  readonly x: number;
  readonly y: number;
}
export type BubbleSide = 'above' | 'below' | 'right' | 'left';
export interface BubblePlace {
  readonly left: number;
  readonly top: number;
  readonly side: BubbleSide;
  /** しっぽの位置（上下に置いたときは左から、左右に置いたときは上からの px）。 */
  readonly tail: number;
}

/** カーソルが動く時間。`styles.css` の `.agent-cursor` の transition と合わせる。 */
export const MOVE_MS = 650;
/** 一言の無い強調の枠を出しておく時間。 */
export const HIGHLIGHT_MS = 2600;
/** しばらく指示が無ければ、カーソルも消す（画面に残って人の邪魔をしない）。 */
export const CURSOR_IDLE_MS = 6000;
/** 一言を出しておく時間：最低 5 秒＋1 文字 0.1 秒、上限 20 秒。 */
const SHOW_MIN_MS = 5000;
const SHOW_PER_CHAR_MS = 100;
const SHOW_MAX_MS = 20000;

/** 窓の端とのすき間・指した所とのすき間・しっぽを角から離す量。 */
export const EDGE_PX = 8;
const GAP_PX = 10;
const TAIL_INSET_PX = 14;

export function showMs(message: string, seconds?: number): number {
  if (seconds !== undefined && seconds > 0) return seconds * 1000;
  if (message === '') return HIGHLIGHT_MS;
  return Math.min(SHOW_MAX_MS, SHOW_MIN_MS + [...message].length * SHOW_PER_CHAR_MS);
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * 上 → 下 → 右 → 左の順で、窓に収まる向きに置く。横（上下のとき）・縦（左右のとき）は窓の中へずらす。
 * しっぽは指した所（カーソルの位置）を向く。どこにも入らなければ、右側を窓の中へ寄せて重ねる（読めることを先にする）。
 */
export function bubblePlacement(target: Rect, anchor: Point, size: Size, view: Size): BubblePlace {
  const fitsAbove = target.top - GAP_PX - size.height >= EDGE_PX;
  const fitsBelow = target.bottom + GAP_PX + size.height <= view.height - EDGE_PX;
  if (fitsAbove || fitsBelow) {
    const left = clamp(anchor.x - TAIL_INSET_PX, EDGE_PX, view.width - EDGE_PX - size.width);
    const top = fitsAbove ? target.top - GAP_PX - size.height : target.bottom + GAP_PX;
    return {
      left,
      top,
      side: fitsAbove ? 'above' : 'below',
      tail: clamp(anchor.x - left, TAIL_INSET_PX, size.width - TAIL_INSET_PX),
    };
  }
  const fitsRight = target.right + GAP_PX + size.width <= view.width - EDGE_PX;
  const fitsLeft = target.left - GAP_PX - size.width >= EDGE_PX;
  const top = clamp(anchor.y - size.height / 2, EDGE_PX, view.height - EDGE_PX - size.height);
  const tail = clamp(anchor.y - top, TAIL_INSET_PX, size.height - TAIL_INSET_PX);
  if (fitsRight || !fitsLeft) {
    const left = clamp(target.right + GAP_PX, EDGE_PX, view.width - EDGE_PX - size.width);
    return { left, top, side: 'right', tail };
  }
  return { left: target.left - GAP_PX - size.width, top, side: 'left', tail };
}
