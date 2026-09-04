import { describe, expect, it, vi } from 'vitest';

import { watchParent } from '../src/watch-parent.js';

/**
 * 親（アプリ）が消えたら、Node 側も終わる。
 *
 * **残ると端末を掴んだままになる。**実際に、数日前のものを含めて 12 個残っていた
 * （2026-09-04）。標準入力が閉じるのを待つだけでは足りない — 親が強く落とされたときや、
 * 別の親に付け替えられたときに気づけない。**親の PID を見る。**
 */
describe('watchParent', () => {
  it('親が居なくなったら（PID が 1 になったら）終わらせる', () => {
    vi.useFakeTimers();
    const ppid = vi.fn().mockReturnValueOnce(500).mockReturnValue(1);
    const onOrphan = vi.fn();

    const stop = watchParent({ intervalMs: 1000, ppid, onOrphan });
    vi.advanceTimersByTime(1000);
    expect(onOrphan).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onOrphan).toHaveBeenCalledOnce();

    stop();
    vi.useRealTimers();
  });

  it('二度は呼ばない（後始末を重ねない）', () => {
    vi.useFakeTimers();
    const onOrphan = vi.fn();

    const stop = watchParent({ intervalMs: 1000, ppid: () => 1, onOrphan });
    vi.advanceTimersByTime(5000);

    expect(onOrphan).toHaveBeenCalledOnce();
    stop();
    vi.useRealTimers();
  });

  it('止めたら、もう見ない', () => {
    vi.useFakeTimers();
    const onOrphan = vi.fn();

    const stop = watchParent({ intervalMs: 1000, ppid: () => 1, onOrphan });
    stop();
    vi.advanceTimersByTime(5000);

    expect(onOrphan).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
