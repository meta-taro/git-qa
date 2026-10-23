import type { Action, TargetSession } from '../adapter/types.js';
import type { Target } from './types.js';
import type { PlannedSeek } from './steps.js';

/**
 * **見えるまで送る**（C109）。
 *
 * キーを決まった回数押して送る書き方は、**画面が長くなると同じ所に来なくなった**
 * （PageUp ×3 で出ていた札が、札を 2 つ足したら出なくなった）。
 * 止まる所を「何が見えたか」で書けば、長さに左右されない。
 *
 * 少し送っては読む。**見えたら止まる。送っても画面の文字が変わらなければ、端に着いたと見て止まる**
 * （見えないものを探して、いつまでも送り続けない）。
 */

/** 送る回数の上限。端が分からない相手でも、ここで止まる。 */
const MAX_STROKES = 30;
/** 送ってから読むまでの間。**なめらかに動く画面は、送った直後はまだ動いている**（C108）。 */
const DEFAULT_PAUSE_MS = 400;

/**
 * 1 回に送る量。**画面より遠くへ飛ばさない**（飛ばすと、探す文字が読む前に通り過ぎる）。
 *
 * デスクトップは、なぞった 10 画素を 1 段に換算して回す（`SCROLL_STEP_PX`）。
 * 画面の 4 分の 1 をなぞると 15 段を超え、1 回で画面より遠くへ行く。**30 画素（3 段）にする。**
 * ほかは画面の 4 分の 1。端末はゆっくりなぞる（速くなぞると、指を離した後も流れる）。
 */
const DESKTOP_STROKE_PX = 30;
const STROKE_SHARE = 0.25;
const SWIPE_MS = 400;

export interface SeekOptions {
  readonly readScreenText: (session: TargetSession) => Promise<string>;
  /** 送ってから読むまでの間。**検査では 0 にする。** */
  readonly pauseMs?: number;
}

/** 1 回分のなぞり。**下へ送る＝指を上へ動かす**（端末と同じ向き）。 */
export function seekStroke(
  kind: Target['kind'],
  size: { readonly width: number; readonly height: number },
  direction: PlannedSeek['direction'],
): Extract<Action, { kind: 'swipe' }> {
  const x = Math.round(size.width / 2);
  const middle = Math.round(size.height / 2);
  const reach = kind === 'desktop' ? DESKTOP_STROKE_PX : Math.round(size.height * STROKE_SHARE);
  const half = Math.round(reach / 2);
  const low = { at: 'point' as const, x, y: middle + reach - half };
  const high = { at: 'point' as const, x, y: middle - half };
  const [from, to] = direction === 'down' ? [low, high] : [high, low];
  return {
    kind: 'swipe',
    from,
    to,
    ...(kind === 'android' || kind === 'ios' ? { durationMs: SWIPE_MS } : {}),
  };
}

/**
 * 送る。**見えたら、何回送ったかを返す。**見えなければ理由を投げる
 * （呼ぶ側は、ほかの手順と同じく「どの手順で止まったか」として BLOCKED にする）。
 */
export async function seekUntilVisible(
  session: TargetSession,
  step: PlannedSeek,
  options: SeekOptions,
): Promise<string> {
  if (session.screenSize === undefined) {
    throw new Error('この相手は画面の大きさが分からないので、どこをなぞれば送れるか決められない');
  }
  const size = await session.screenSize();
  const stroke = seekStroke(session.target.kind, size, step.direction);
  const pause = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const way = step.direction === 'down' ? '下' : '上';

  let text = await options.readScreenText(session);
  if (text.includes(step.target)) return `送る前から「${step.target}」が見えていた`;

  for (let strokes = 1; strokes <= MAX_STROKES; strokes += 1) {
    await session.act(stroke);
    if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
    const again = await options.readScreenText(session);
    if (again.includes(step.target))
      return `${way}へ ${String(strokes)} 回送って「${step.target}」が見えた`;
    if (again === text) {
      /*
       * **「端に着いた」とは言い切らない**（2026-10-24・Chrome で実測）。
       * ウェブの画面の文字はページ全体なので、送っても変わらない。端か、送れていないか、
       * 読める文字が送る前と同じなのかは、ここからは分からない。
       */
      throw new Error(
        `${way}へ送っても画面の文字が変わらなくなった（端に着いたか、送れていない）。` +
          `「${step.target}」は見えなかった（${String(strokes)} 回送った）`,
      );
    }
    text = again;
  }
  throw new Error(`${way}へ ${String(MAX_STROKES)} 回送っても「${step.target}」が見えなかった`);
}
