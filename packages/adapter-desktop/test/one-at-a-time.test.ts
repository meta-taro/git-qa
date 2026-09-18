import { describe, expect, it } from 'vitest';

import { oneAtATime } from '../src/one-at-a-time.js';

/**
 * **同時に 1 本しか走らせない**（外部レビュー meta-taro/git-qa#34）。
 *
 * > **常時 28 個前後が同時に生きていました。**1 つ 1 つは短命ですが、
 * > **死ぬより速く生まれています。**
 *
 * 根っこは橋の側（読み手が去っても撮り続けていた）だが、**撮る側にも重ね止めを置く。**
 * **遅い機械ほど積み上がる**形なので、速い機械では出ない —— つまり
 * **出る所でだけ出る**（いちばん見つけにくい）。
 */
describe('oneAtATime', () => {
  it('走っている間に来た依頼は、同じ 1 本に相乗りする', async () => {
    let started = 0;
    const slow = oneAtATime(async () => {
      started += 1;
      await new Promise((r) => setTimeout(r, 30));
      return started;
    });

    const [a, b, c] = await Promise.all([slow(), slow(), slow()]);

    // **3 回頼まれても、走ったのは 1 本。**
    expect(started).toBe(1);
    expect([a, b, c]).toEqual([1, 1, 1]);
  });

  it('終わったあとの依頼は、新しく走る', async () => {
    let started = 0;
    const once = oneAtATime(() => {
      started += 1;
      return Promise.resolve(started);
    });

    await once();
    await once();

    expect(started).toBe(2);
  });

  /** **落ちても、次を止めない。**1 回の失敗で映像が終わらないように。 */
  it('落ちたあとも、次は走る', async () => {
    let started = 0;
    const flaky = oneAtATime(() => {
      started += 1;
      return started === 1 ? Promise.reject(new Error('だめ')) : Promise.resolve(started);
    });

    await expect(flaky()).rejects.toThrow('だめ');
    await expect(flaky()).resolves.toBe(2);
  });
});
