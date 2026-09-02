import type { HumanInput, SessionState } from '@git-qa/core/session';

/**
 * 人がライブビューを押した所を、端末の座標へ直して送る（Issue 013）。
 *
 * **AI が判断保留にして止まった後、人が自分で触って確かめる**のがこの製品の中心の動き。
 * **見えるが触れない画面は、判断の材料にならない。**
 */

export interface DevicePointParams {
  readonly clientX: number;
  readonly clientY: number;
  /** canvas 要素の枠（画面上の位置と大きさ）。 */
  readonly rect: { left: number; top: number; width: number; height: number };
  /** 端末の実寸（canvas の中身の大きさ）。 */
  readonly canvas: { width: number; height: number };
}

/**
 * 押した位置を端末の画素へ直す。**描かれていない所（余白）なら `undefined`。**
 *
 * canvas は `object-fit: contain` で描かれる（端末の縦横比を保つため）。
 * 枠と端末で比が違うと余白が出るので、押した位置をそのまま端末の座標にはできない。
 */
export function devicePoint(params: DevicePointParams): { x: number; y: number } | undefined {
  const { rect, canvas } = params;
  if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    // 測れないまま送ると、見当違いの所を触る。**触らないほうがよい。**
    return undefined;
  }

  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const drawnWidth = canvas.width * scale;
  const drawnHeight = canvas.height * scale;
  const originX = rect.left + (rect.width - drawnWidth) / 2;
  const originY = rect.top + (rect.height - drawnHeight) / 2;

  const x = Math.round((params.clientX - originX) / scale);
  const y = Math.round((params.clientY - originY) / scale);

  // 余白と枠の外。人は黒い所を押している。
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return undefined;
  return { x, y };
}

export interface InstallDeviceTouchOptions {
  readonly canvas: HTMLCanvasElement;
  /** いまの実行状態。**人の番かどうかはここで見る。** */
  readonly state: () => SessionState | undefined;
  readonly send: (input: HumanInput) => void;
}

export function installDeviceTouch(options: InstallDeviceTouchOptions): () => void {
  const onClick = (event: MouseEvent): void => {
    const state = options.state();
    const caseNo = state?.awaiting;
    // **人の番のときだけ送る。**AI が操作している最中に割り込むと、
    // どちらが触ったのか証跡から読めなくなる。
    if (state === undefined || state.phase !== 'waiting' || caseNo === undefined) return;

    const point = devicePoint({
      clientX: event.clientX,
      clientY: event.clientY,
      rect: options.canvas.getBoundingClientRect(),
      canvas: { width: options.canvas.width, height: options.canvas.height },
    });
    if (point === undefined) return;

    options.send({ kind: 'tap', caseNo, x: point.x, y: point.y });
  };

  options.canvas.addEventListener('click', onClick);
  return () => options.canvas.removeEventListener('click', onClick);
}
