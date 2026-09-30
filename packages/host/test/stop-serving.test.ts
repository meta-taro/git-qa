import { describe, expect, it } from 'vitest';

import { stopServing } from '../src/stop-serving.js';

/**
 * **親が居なくなったら、必ず終わる**（meta-taro/git-qa#34・2026-09-30 の報告）。
 *
 * アプリを SIGTERM で止めたら、`host-bundle.mjs --serve` だけが親を失って**一晩中動き続けた。**
 * 見張りは付いていたが、止める処理が 2 つの形で終わらなかった。
 *
 * 1. 実行が動いていない（session が無い）と、**何もしないまま戻っていた**
 * 2. 後片付けが返らないと、**いつまでも待っていた**
 */
describe('stopServing', () => {
  it('実行が動いていなくても、終わる', async () => {
    const exits: number[] = [];

    await stopServing({ session: undefined, exit: (code) => exits.push(code), timeoutMs: 1000 });

    expect(exits).toEqual([0]);
  });

  it('後片付けが済めば、その場で終わる', async () => {
    const exits: number[] = [];
    let closed = false;

    await stopServing({
      session: {
        close: () => {
          closed = true;
          return Promise.resolve();
        },
      },
      exit: (code) => exits.push(code),
      timeoutMs: 1000,
    });

    expect(closed).toBe(true);
    expect(exits).toEqual([0]);
  });

  it('後片付けが返らなくても、上限が来たら終わる', async () => {
    const exits: number[] = [];
    const started = Date.now();

    await stopServing({
      session: { close: () => new Promise<void>(() => undefined) },
      exit: (code) => exits.push(code),
      timeoutMs: 50,
    });

    expect(exits).toEqual([0]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('後片付けが落ちても、終わる', async () => {
    const exits: number[] = [];

    await stopServing({
      session: { close: () => Promise.reject(new Error('端末が居ない')) },
      exit: (code) => exits.push(code),
      timeoutMs: 1000,
    });

    expect(exits).toEqual([0]);
  });
});
