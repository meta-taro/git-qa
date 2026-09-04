import type { HumanInput, SessionState } from '@git-qa/core/session';

import { devicePoint } from './touch.js';

/**
 * ライブビューの上でホイールを回したら、端末をスクロールさせる。
 *
 * **タップとなぞるだけでは、長い画面の下が見られない。**人が見て判断するための道具なので、
 * 見えない所が残るのは困る。
 *
 * **回すたびに送らない。**ホイールは 1 回転で何十回も飛んでくる。そのたびに `input swipe`
 * を出すと adb が詰まり、端末は追いつけない。**貯めてから 1 回のなぞりにする。**
 */

/** 行単位で来たときの 1 行の高さ（px）。ブラウザの既定に合わせた目安。 */
const LINE_HEIGHT = 16;

/** これだけ貯まったら、止まるのを待たずに送る。**回し続けても動き出す**ため。 */
const FLUSH_PX = 300;

/** 手が止まったと見なすまで。短いと 1 回転が細切れになり、長いと反応が鈍い。 */
const IDLE_MS = 120;

/** なぞる速さ。**速すぎると端末が弾き（フリック）として受け取る。** */
const MIN_DURATION_MS = 80;
const MAX_DURATION_MS = 400;

/** 端末の縁で始めない。縁から始めると、通知や戻るの操作として取られる。 */
const EDGE_MARGIN = 0.15;

export interface WheelPixelsParams {
  readonly deltaX: number;
  readonly deltaY: number;
  /** 0=画素 / 1=行 / 2=頁。ブラウザと入力機器で変わる。 */
  readonly deltaMode: number;
  /** 頁で来たときの 1 頁分。 */
  readonly pageHeight?: number;
}

/** 回した量を画素へ揃える。**単位が混ざったまま計算しない。** */
export function wheelPixels(params: WheelPixelsParams): { dx: number; dy: number } {
  const scale =
    params.deltaMode === 1 ? LINE_HEIGHT : params.deltaMode === 2 ? (params.pageHeight ?? 800) : 1;
  return { dx: params.deltaX * scale, dy: params.deltaY * scale };
}

export interface InstallDeviceWheelOptions {
  readonly canvas: HTMLCanvasElement;
  /** いまの実行状態。**人の番かどうかはここで見る。** */
  readonly state: () => SessionState | undefined;
  readonly send: (input: HumanInput) => void;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

export function installDeviceWheel(options: InstallDeviceWheelOptions): () => void {
  /** 貯めている量（端末の画素）と、回している場所。 */
  let acc = { dx: 0, dy: 0 };
  let anchor: { x: number; y: number } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const from = anchor;
    const { dx, dy } = acc;
    acc = { dx: 0, dy: 0 };
    anchor = undefined;
    if (from === undefined || (dx === 0 && dy === 0)) return;

    const state = options.state();
    const caseNo = state?.awaiting;
    // **人の番のときだけ送る。**AI が操作している最中に割り込むと、
    // どちらが触ったのか証跡から読めなくなる。
    if (state === undefined || state.phase !== 'waiting' || caseNo === undefined) return;

    const screen = { x: options.canvas.width, y: options.canvas.height };
    // 縁から始めない。縁は通知や「戻る」の縄張り。
    const lowX = Math.round(screen.x * EDGE_MARGIN);
    const highX = Math.round(screen.x * (1 - EDGE_MARGIN));
    const lowY = Math.round(screen.y * EDGE_MARGIN);
    const highY = Math.round(screen.y * (1 - EDGE_MARGIN));

    // **下へ回す（dy > 0）＝指は上へ動く。**逆にすると画面が逆に動く。
    const startX = clamp(from.x, lowX, highX);
    const startY = clamp(from.y, lowY, highY);
    const to = {
      x: clamp(Math.round(startX - dx), 0, screen.x - 1),
      y: clamp(Math.round(startY - dy), 0, screen.y - 1),
    };
    if (to.x === startX && to.y === startY) return;

    const distance = Math.hypot(to.x - startX, to.y - startY);
    options.send({
      kind: 'swipe',
      caseNo,
      from: { x: startX, y: startY },
      to,
      durationMs: Math.round(clamp(distance / 2, MIN_DURATION_MS, MAX_DURATION_MS)),
      screen,
    });
  };

  const onWheel = (event: WheelEvent): void => {
    const point = devicePoint({
      clientX: event.clientX,
      clientY: event.clientY,
      rect: options.canvas.getBoundingClientRect(),
      canvas: { width: options.canvas.width, height: options.canvas.height },
    });
    // 余白（黒い所）で回している。端末のどこでもない。
    if (point === undefined) return;
    // 画面ごと動かさない。**枠の中で回している間は、こちらが受け取る。**
    event.preventDefault();

    const rect = options.canvas.getBoundingClientRect();
    const { dx, dy } = wheelPixels({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      pageHeight: rect.height,
    });
    // 枠の画素から端末の画素へ。映像は端末より小さく描かれている。
    const scale = rect.height > 0 ? options.canvas.height / Math.max(1, rect.height) : 1;
    anchor ??= point;
    acc = { dx: acc.dx + dx * scale, dy: acc.dy + dy * scale };

    if (Math.hypot(acc.dx, acc.dy) >= FLUSH_PX) {
      // 回し続けている。**止まるのを待たずに動かす。**
      flush();
      return;
    }
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, IDLE_MS);
  };

  options.canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    options.canvas.removeEventListener('wheel', onWheel);
  };
}
