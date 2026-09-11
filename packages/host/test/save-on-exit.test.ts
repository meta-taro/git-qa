import { describe, expect, it, vi } from 'vitest';

import { installSaveOnExit } from '../src/save-on-exit.js';

/**
 * **落ちても、人が置いた判定を失わない**（外部レビュー meta-taro/git-qa#2）。
 *
 * > シート実行の途中で host が落ちると、それまでに人が置いた判定が全部消えます。
 *
 * 数えたら、そのとおりだった。
 *
 * ```
 * run-cli: 0 / run-web-cli: 0 / run-desktop-cli: 0 / app-cli: 2
 * ```
 *
 * **人が横に座って判定を置く 3 つが、揃って signal を拾っていなかった。**
 * 証跡は「最後に 1 回」しか書かれないので、`session.done` に着く前に死ぬと**全部消える。**
 */
describe('installSaveOnExit', () => {
  const signals = (): { on: ReturnType<typeof vi.fn>; fire: (name: string) => Promise<void> } => {
    const handlers = new Map<string, () => void>();
    const on = vi.fn((name: string, handler: () => void) => {
      handlers.set(name, handler);
    });
    return {
      on,
      fire: async (name: string) => {
        handlers.get(name)?.();
        await Promise.resolve();
      },
    };
  };

  it('SIGINT と SIGTERM の両方を拾う', () => {
    const { on } = signals();

    installSaveOnExit({ on, save: vi.fn(), exit: vi.fn() });

    expect(on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('拾ったら、証跡を書いてから終わる', async () => {
    const order: string[] = [];
    const { on, fire } = signals();
    const save = vi.fn(() => {
      order.push('save');
      return Promise.resolve();
    });
    const exit = vi.fn(() => {
      order.push('exit');
    });

    installSaveOnExit({ on, save, exit });
    await fire('SIGINT');
    await Promise.resolve();

    expect(order).toEqual(['save', 'exit']);
  });

  /** **2 度目は動かさない。**書いている最中にもう一度来ると、同じ証跡を 2 回書く。 */
  it('2 度来ても、書くのは 1 回', async () => {
    const { on, fire } = signals();
    const save = vi.fn(() => Promise.resolve());

    installSaveOnExit({ on, save, exit: vi.fn() });
    await fire('SIGINT');
    await fire('SIGTERM');

    expect(save).toHaveBeenCalledTimes(1);
  });

  /** **書けなくても終わる。**書けないことを理由に、掴んだまま居座らない。 */
  it('書けなくても終わる（理由は呼び側が出す）', async () => {
    const { on, fire } = signals();
    const exit = vi.fn();

    installSaveOnExit({ on, save: () => Promise.reject(new Error('書けない')), exit });
    await fire('SIGTERM');
    await Promise.resolve();
    await Promise.resolve();

    expect(exit).toHaveBeenCalled();
  });
});
