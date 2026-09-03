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
  /** 時刻の出どころ。**なぞった速さがそのまま端末へ伝わる**ので、検査では固定する。 */
  readonly now?: () => number;
}

/** これ以下しか動いていなければタップ扱い（端末の画素）。手が少し震えても拾わない。 */
const TAP_SLOP = 16;

/** `input swipe` に渡す時間の幅。速すぎても遅すぎても端末が受け取らない。 */
const MIN_DURATION_MS = 20;
const MAX_DURATION_MS = 5_000;

/** これ以上押し続けたら長押し。**メニューを出す操作**がこれ。 */
const LONG_PRESS_MS = 500;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * ライブビューの上での操作を、端末へ送る。
 *
 * **押して離すまでを見る。**同じ所なら tap、離れていれば swipe（フリック）。
 * タップだけでは Android を操作できない — ホームへ戻る・一覧をたどる基本の動きが
 * なぞる操作で、無いと人は画面の外へ出られない。
 */
export function installDeviceTouch(options: InstallDeviceTouchOptions): () => void {
  const now = options.now ?? ((): number => performance.now());
  let start: { x: number; y: number; at: number; caseNo: number } | undefined;

  const pointFrom = (event: MouseEvent): { x: number; y: number } | undefined =>
    devicePoint({
      clientX: event.clientX,
      clientY: event.clientY,
      rect: options.canvas.getBoundingClientRect(),
      canvas: { width: options.canvas.width, height: options.canvas.height },
    });

  const onDown = (event: MouseEvent): void => {
    start = undefined;
    const state = options.state();
    const caseNo = state?.awaiting;
    // **人の番のときだけ送る。**AI が操作している最中に割り込むと、
    // どちらが触ったのか証跡から読めなくなる。
    if (state === undefined || state.phase !== 'waiting' || caseNo === undefined) return;

    const point = pointFrom(event);
    // 余白（黒い所）から始まった操作は、端末のどこでもない。
    if (point === undefined) return;
    start = { ...point, at: now(), caseNo };
  };

  const onUp = (event: MouseEvent): void => {
    const from = start;
    start = undefined;
    // 押していないのに離した（枠の外で押し始めた等）。
    if (from === undefined) return;

    const to = pointFrom(event);
    if (to === undefined) return;

    const screen = { x: options.canvas.width, y: options.canvas.height };
    const moved = Math.hypot(to.x - from.x, to.y - from.y);
    const heldMs = Math.round(clamp(now() - from.at, MIN_DURATION_MS, MAX_DURATION_MS));

    if (moved <= TAP_SLOP) {
      // **どの大きさの画面上の座標かを添える。**映像は端末より小さく流しているので、
      // 受け取った側で端末の実寸へ戻す必要がある。
      if (heldMs >= LONG_PRESS_MS) {
        // 押し続けた。**メニューを出す操作**がこれ。
        options.send({
          kind: 'longPress',
          caseNo: from.caseNo,
          x: to.x,
          y: to.y,
          durationMs: heldMs,
          screen,
        });
        return;
      }
      options.send({ kind: 'tap', caseNo: from.caseNo, x: to.x, y: to.y, screen });
      return;
    }

    options.send({
      kind: 'swipe',
      caseNo: from.caseNo,
      from: { x: from.x, y: from.y },
      to,
      durationMs: heldMs,
      screen,
    });
  };

  options.canvas.addEventListener('mousedown', onDown);
  options.canvas.addEventListener('mouseup', onUp);
  return () => {
    options.canvas.removeEventListener('mousedown', onDown);
    options.canvas.removeEventListener('mouseup', onUp);
  };
}
