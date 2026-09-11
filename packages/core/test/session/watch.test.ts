import { describe, expect, it } from 'vitest';

import { WATCH_PAUSE_MS, watchPause } from '../../src/session/watch.js';
import type { HumanInput } from '../../src/session/protocol.js';

/**
 * **鑑賞モードの「間」**（2026-09-11・人の指示）。
 *
 * > 人はぼーっとみながら AI のテストを鑑賞します。……途中で止められる配慮も必要です。
 *
 * 1 件ごとに少し止まる。**人が押せば、その判定になる。押さなければ進む。**
 * 押していないものを「人が見て置いた」にはしない（`AUTO_PASS`・C1）。
 */

const never = new Promise<HumanInput | undefined>(() => undefined);

describe('watchPause', () => {
  it('人が押さなければ、間をおいて進む', async () => {
    const slept: number[] = [];

    const out = await watchPause({
      input: never,
      pauseMs: 3000,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });

    expect(out).toEqual({ kind: 'advanced' });
    expect(slept).toEqual([3000]);
  });

  it('人が判定を置けば、それを返す', async () => {
    const input: HumanInput = { kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' };

    const out = await watchPause({
      input: Promise.resolve(input),
      pauseMs: 3000,
      sleep: () => never.then(() => undefined),
    });

    expect(out).toEqual({ kind: 'placed', input });
  });

  /** **止められることが要る。**見ているだけの人が止められないのは、見ているだけより悪い。 */
  it('人が止めれば、止まる', async () => {
    const out = await watchPause({
      input: Promise.resolve({ kind: 'stop', caseNo: 1 }),
      pauseMs: 3000,
      sleep: () => never.then(() => undefined),
    });

    expect(out).toEqual({ kind: 'stopped' });
  });

  /** 判定を置かずに送った（`advance`）は、**進むのと同じ。**繰り上げない。 */
  it('判定を置かずに送られたら、進む', async () => {
    const out = await watchPause({
      input: Promise.resolve({ kind: 'advance', caseNo: 1 }),
      pauseMs: 3000,
      sleep: () => never.then(() => undefined),
    });

    expect(out).toEqual({ kind: 'advanced' });
  });

  /** **間は 0 にしない。**0 だと人は何も見られず、鑑賞にならない。 */
  it('既定の間は、人が見て分かる長さ', () => {
    expect(WATCH_PAUSE_MS).toBeGreaterThanOrEqual(2000);
  });
});
