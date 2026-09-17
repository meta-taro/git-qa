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

  it('始めたら、来た絵を並び順で溜める', async () => {
    const { written, made } = deps();

    await made.start?.(1);
    made.accept(new Uint8Array([1]));
    made.accept(new Uint8Array([2]));
    await new Promise((r) => setTimeout(r, 10));

    expect(written).toEqual(['/runs/case-001/frames/00001.jpg', '/runs/case-001/frames/00002.jpg']);
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
