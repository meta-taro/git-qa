import type { HumanInput } from './protocol.js';

/**
 * **鑑賞モードの「間」**（2026-09-11・人の指示）。
 *
 * > auto を git-qa まんま操作するパターンを実装します。……人はぼーっとみながら
 * > AI のテストを鑑賞します。……途中で止められる配慮も必要です。
 *
 * 1 件ごとに少し止まる。**人が押せば、その判定になる。押さなければ進む。**
 *
 * **押していないものを「人が見て置いた」にしない**（`AUTO_PASS`・C1）。
 * 見ていたかどうかは、この道具には分からない。分からないものを、分かったことにしない。
 *
 * **止める口を必ず持つ。**見ているだけの人が止められないのは、見ているだけより悪い。
 */

export type WatchOutcome =
  /** 人が判定を置いた。**見ていた人の判定になる。** */
  | { readonly kind: 'placed'; readonly input: HumanInput }
  /** 間が過ぎた（あるいは人が送った）。**繰り上げない。** */
  | { readonly kind: 'advanced' }
  /** 人が止めた。**残りは判断保留として残す。** */
  | { readonly kind: 'stopped' };

/**
 * 1 件を見せる間の長さ。
 *
 * **0 にしない。**0 だと人は何も見られず、鑑賞にならない。
 * 長すぎても、見ている人が待たされるだけ。
 */
export const WATCH_PAUSE_MS = 4000;

export interface WatchPauseOptions {
  /** 人の打鍵。**来ないこともある**（見ているだけ）。 */
  readonly input: Promise<HumanInput | undefined>;
  readonly pauseMs: number;
  /** 間をおく。**検査では差し替える。** */
  readonly sleep: (ms: number) => Promise<void>;
}

export async function watchPause(options: WatchPauseOptions): Promise<WatchOutcome> {
  const advanced: WatchOutcome = { kind: 'advanced' };

  const fromHuman = options.input.then((input): WatchOutcome => {
    if (input === undefined) return advanced;
    if (input.kind === 'stop') return { kind: 'stopped' };
    if (input.kind === 'verdict') return { kind: 'placed', input };
    // `advance` など。**判定は置かれていない。**
    return advanced;
  });

  return Promise.race([fromHuman, options.sleep(options.pauseMs).then(() => advanced)]);
}
