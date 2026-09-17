import { describe, expect, it, vi } from 'vitest';

import { createFrameRecording } from '../src/frame-recording.js';

/**
 * **人が見ていた映像を、そのまま証跡に残す**（meta-taro/git-qa#31）。
 *
 * ウェブと Windows には録画が無い。どちらも**ライブ映像は 1 枚ずつの絵**なので、
 * **同じ絵を溜めて繋ぐ。**
 *
 * **録っていないことと、録れなかったことを混ぜない**（C20）。
 * 頼まれていなければ `not_requested`、道具が無ければ理由つきで残す。
 */
const deps = (over: Partial<Parameters<typeof createFrameRecording>[0]> = {}) => {
  const written: string[] = [];
  return {
    written,
    made: createFrameRecording({
      dirFor: (caseNo) => `/runs/case-${String(caseNo).padStart(3, '0')}/frames`,
      ensureDir: () => Promise.resolve(),
      writeFrame: (path) => {
        written.push(path);
        return Promise.resolve();
      },
      toWebm: () => Promise.resolve({ name: 'screen.webm' }),
      removeFrames: () => Promise.resolve(),
      now: () => new Date('2026-09-17T12:00:00Z'),
      fps: 8,
      ...over,
    }),
  };
};

describe('createFrameRecording', () => {
  it('頼まれるまでは、1 枚も溜めない', async () => {
    const { written, made } = deps();

    made.accept(new Uint8Array([1]));
    await Promise.resolve();

    expect(written).toEqual([]);
    expect(await made.stop()).toMatchObject({ state: 'not_requested' });
  });

  /**
   * **書くのは時計だけ**（2026-09-17 に模型を入れ替えた・#31）。
   *
   * 来た絵をそのつど書いていたが、**それだと速さが揺れて動画の長さが合わない。**
   * いまは**一定の間隔で最後の絵を置く**ので、
   * 最初の 1 枚だけが即座に出て、あとは時計が出す。
   */
  it('始めたら、まず 1 枚置く（あとは時計が置く）', async () => {
    const { written, made } = deps();

    await made.start?.(1);
    made.accept(new Uint8Array([1]));
    made.accept(new Uint8Array([2]));
    await new Promise((r) => setTimeout(r, 10));

    expect(written).toEqual(['/runs/case-001/frames/00001.jpg']);
  });

  it('止めたら、繋いで名前を返す', async () => {
    const { made } = deps();
    await made.start?.(1);
    made.accept(new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 10));

    const saved = await made.stop();

    expect(saved).toMatchObject({ state: 'recorded', file: 'screen.webm' });
  });

  /** **1 枚も来ていないなら、動画は作らない。**空の webm を証跡に置かない。 */
  it('1 枚も来ていなければ、失敗として理由を残す', async () => {
    const { made } = deps();
    await made.start?.(1);

    const saved = await made.stop();

    expect(saved).toMatchObject({ state: 'failed' });
    expect(saved.state === 'failed' ? saved.reason : '').toContain('1 枚も');
  });

  /** **道具が無いのは「持っていない」。**失敗にしない（C20）。 */
  it('道具が無ければ、持っていないと言う', async () => {
    const { made } = deps({ toWebm: () => Promise.resolve(undefined) });
    await made.start?.(1);
    made.accept(new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 10));

    const saved = await made.stop();

    expect(saved).toMatchObject({ state: 'unsupported' });
  });

  /** **溜めた絵は片付ける。**1 件ごとに数百枚が残ると、証跡が読めなくなる。 */
  it('繋いだあと、溜めた絵を片付ける', async () => {
    const removed = vi.fn(() => Promise.resolve());
    const { made } = deps({ removeFrames: removed });
    await made.start?.(1);
    made.accept(new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 10));
    await made.stop();

    expect(removed).toHaveBeenCalled();
  });
});

/**
 * **絵が来なくても、時間は流れる**（meta-taro/git-qa#31 の実測から）。
 *
 * CDP の映像は**変化したときだけ**絵を出す。画面が止まっていると 1 枚も来ないので、
 * **1 ケースにつき絵が 1 枚 → 0.125 秒の動画**になっていた。
 *
 * **最後の絵を、一定の間隔で置き直す。**同じ穴を macOS の窓録画でも踏んで、
 * 同じ手（最後の 1 枚を入れ直す）で直した。
 */
describe('createFrameRecording — 止まっている画面も録る', () => {
  const ticking = () => {
    const written: { path: string; byte: number }[] = [];
    return {
      written,
      made: createFrameRecording({
        dirFor: () => '/runs/case-001/frames',
        ensureDir: () => Promise.resolve(),
        writeFrame: (path, bytes) => {
          written.push({ path, byte: bytes[0] ?? 0 });
          return Promise.resolve();
        },
        toWebm: () => Promise.resolve({ name: 'screen.webm' }),
        removeFrames: () => Promise.resolve(),
        now: () => new Date(),
        fps: 8,
        tickMs: 10,
      }),
    };
  };

  it('絵が来なくても、間隔ごとに置き直す', async () => {
    const { written, made } = ticking();
    await made.start?.(1);
    made.accept(new Uint8Array([7]));

    await new Promise((r) => setTimeout(r, 55));
    await made.stop();

    // 10ms ごとなので、50ms で数枚は置かれている。**1 枚では終わらない。**
    expect(written.length).toBeGreaterThan(2);
    // 置き直しているのは**最後に来た絵**。
    expect(written.every((w) => w.byte === 7)).toBe(true);
  });

  /** **新しい絵が来たら、そちらに替わる。**止まった絵を出し続けない。 */
  it('新しい絵が来たら、そちらを置く', async () => {
    const { written, made } = ticking();
    await made.start?.(1);
    made.accept(new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 25));
    made.accept(new Uint8Array([2]));
    await new Promise((r) => setTimeout(r, 25));
    await made.stop();

    expect(written.map((w) => w.byte)).toContain(1);
    expect(written.map((w) => w.byte)).toContain(2);
  });

  /** **止めたら、置き直しも止まる。**走っていない間に証跡が太らない。 */
  it('止めたら、置き直さない', async () => {
    const { written, made } = ticking();
    await made.start?.(1);
    made.accept(new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 25));
    await made.stop();
    const after = written.length;

    await new Promise((r) => setTimeout(r, 40));

    expect(written.length).toBe(after);
  });

  /** **1 枚も来ていないなら、置き直すものが無い。**空の動画を作らない。 */
  it('1 枚も来ていなければ、置き直さない', async () => {
    const { written, made } = ticking();
    await made.start?.(1);
    await new Promise((r) => setTimeout(r, 35));
    const saved = await made.stop();

    expect(written).toEqual([]);
    expect(saved).toMatchObject({ state: 'failed' });
  });
});
