import { MAIN_COLUMN_ID } from '../columns.js';
import type { DecodedFrame } from './player.js';

/**
 * ライブ映像を中央カラムの中に描く。**別窓ではなく枠の中**（C27 の方式 A / C4）。
 */

export interface LiveSurface {
  readonly canvas: HTMLCanvasElement;
  draw(frame: DecodedFrame): void;
  /** 枠を外して、説明文へ戻す。 */
  unmount(): void;
}

/** 絵を canvas へ描けるだけの最小の口。`drawImage` は CanvasImageSource を取る。 */
type Drawable = CanvasImageSource;

export interface MountLiveViewOptions {
  readonly width: number;
  readonly height: number;
}

/**
 * 映らない理由を、中央のカラムに出す。
 *
 * **console だけに出しても人には見えない。**見えないと、人は「そのうち出るのだろう」と
 * 待ち続ける。ライブビューが主媒体（C4）である以上、ここが空のまま黙るのが一番まずい。
 */
export function showLiveViewError(root: HTMLElement, message: string): void {
  const column = liveColumn(root);

  // 映像の枠と、前に出した理由は消す。黒い枠が残ると、
  // 映っていないのか真っ黒なのかが分からない。
  column.querySelector('.live-canvas')?.remove();
  column.querySelector('.live-error')?.remove();
  column.querySelector('.column-placeholder')?.remove();

  const paragraph = root.ownerDocument.createElement('p');
  paragraph.className = 'live-error';
  paragraph.textContent = message;
  column.append(paragraph);
}

function liveColumn(root: HTMLElement): HTMLElement {
  const column = root.querySelector<HTMLElement>(`[data-column-id="${MAIN_COLUMN_ID}"]`);
  if (column === null) {
    // 握り潰さない。カラムの構成を変えたときに、静かに映らなくなるのを防ぐ。
    throw new Error(`ライブビューのカラム（${MAIN_COLUMN_ID}）が画面に無い`);
  }
  return column;
}

export function mountLiveView(root: HTMLElement, options: MountLiveViewOptions): LiveSurface {
  const column = liveColumn(root);

  const placeholder = column.querySelector('.column-placeholder');
  const canvas = root.ownerDocument.createElement('canvas');
  canvas.className = 'live-canvas';
  canvas.width = options.width;
  canvas.height = options.height;

  placeholder?.remove();
  column.append(canvas);

  const context = canvas.getContext('2d');

  return {
    canvas,
    draw(frame) {
      // 端末の実寸に合わせる。**引き伸ばすと、人が見て判断する材料が歪む。**
      // 実寸は最初の絵が来るまで分からないので、来た時点で合わせ直す。
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      if (w !== undefined && h !== undefined && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
      // 2d コンテキストが取れない環境（テスト用の DOM 等）では描かない。
      // ここで落とすと、画面の組み立てそのものを検査できなくなる。
      context?.drawImage(frame as unknown as Drawable, 0, 0, canvas.width, canvas.height);
    },
    unmount() {
      canvas.remove();
      if (placeholder !== null && placeholder !== undefined) column.append(placeholder);
    },
  };
}
