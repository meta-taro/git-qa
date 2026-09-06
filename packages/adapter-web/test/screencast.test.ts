import { describe, expect, it } from 'vitest';

import { createFrameSplitter } from '@git-qa/core';

import { createScreencast } from '../src/screencast.js';
import type { CdpClient, CdpParams } from '../src/cdp.js';

/**
 * ブラウザの画面を、1 枚ずつ受け取って橋へ流す（C54）。
 *
 * Android は `screenrecord` の生 H.264 を流していた。ブラウザは
 * `Page.screencastFrame` で**画像 1 枚ずつ + 受け取りの返事**という形なので、道が違う。
 *
 * **返事を返さないと次が来ない。**返し忘れると 1 枚で止まり、
 * 画面は最初の 1 枚のまま固まる（人から見ると「映像が止まった」）。
 */

/** ブラウザの代わり。**送った命令を握り、好きな絵を流し込める。** */
function fakeCdp(): CdpClient & {
  calls: { method: string; params?: CdpParams }[];
  emit: (method: string, params: CdpParams) => void;
} {
  const calls: { method: string; params?: CdpParams }[] = [];
  const listeners = new Map<string, Set<(params: CdpParams) => void>>();

  return {
    calls,
    send: (method, params) => {
      calls.push(params === undefined ? { method } : { method, params });
      return Promise.resolve({});
    },
    on: (method, handler) => {
      const set = listeners.get(method) ?? new Set();
      set.add(handler);
      listeners.set(method, set);
      return () => set.delete(handler);
    },
    close: () => Promise.resolve(),
    emit: (method, params) => {
      for (const handler of listeners.get(method) ?? []) handler(params);
    },
  };
}

/** 絵 1 枚ぶんの base64（中身は何でもよい。運ばれ方だけを見る）。 */
const image = (...values: number[]): string => Buffer.from(values).toString('base64');

const drain = async (frames: AsyncIterable<Uint8Array>, want: number): Promise<Uint8Array[]> => {
  const splitter = createFrameSplitter();
  const out: Uint8Array[] = [];
  for await (const chunk of frames) {
    out.push(...splitter.push(chunk));
    if (out.length >= want) break;
  }
  return out;
};

describe('createScreencast', () => {
  it('始めるとブラウザへ流し始めるよう頼む', async () => {
    const cdp = fakeCdp();
    const cast = createScreencast(cdp);

    const frames = cast.frames();
    const pending = drain(frames, 1);
    cdp.emit('Page.screencastFrame', { data: image(1), sessionId: 1 });
    await pending;

    expect(cdp.calls.map((c) => c.method)).toContain('Page.startScreencast');
  });

  it('届いた絵を、長さを付けて流す', async () => {
    const cdp = fakeCdp();
    const cast = createScreencast(cdp);

    const pending = drain(cast.frames(), 2);
    cdp.emit('Page.screencastFrame', { data: image(1, 2), sessionId: 1 });
    cdp.emit('Page.screencastFrame', { data: image(3), sessionId: 2 });

    expect(await pending).toEqual([new Uint8Array([1, 2]), new Uint8Array([3])]);
  });

  /**
   * **返事を返さないと次が来ない。**ここを落とすと 1 枚で止まる。
   * 「映像が止まった」の原因として、いちばん見つけにくい形。
   */
  it('1 枚ごとに受け取りの返事を返す（返さないと次が来ない）', async () => {
    const cdp = fakeCdp();
    const cast = createScreencast(cdp);

    const pending = drain(cast.frames(), 1);
    cdp.emit('Page.screencastFrame', { data: image(1), sessionId: 42 });
    await pending;

    expect(cdp.calls).toContainEqual({
      method: 'Page.screencastFrameAck',
      params: { sessionId: 42 },
    });
  });

  it('読み手が去ったら、ブラウザにも止めてもらう（流しっぱなしにしない）', async () => {
    const cdp = fakeCdp();
    const cast = createScreencast(cdp);

    const pending = drain(cast.frames(), 1);
    cdp.emit('Page.screencastFrame', { data: image(1), sessionId: 1 });
    await pending;
    await cast.close();

    expect(cdp.calls.map((c) => c.method)).toContain('Page.stopScreencast');
  });

  it('中身の無い通知は流さない（空の絵で受け手を混乱させない）', async () => {
    const cdp = fakeCdp();
    const cast = createScreencast(cdp);

    const pending = drain(cast.frames(), 1);
    cdp.emit('Page.screencastFrame', { sessionId: 1 });
    cdp.emit('Page.screencastFrame', { data: '', sessionId: 2 });
    cdp.emit('Page.screencastFrame', { data: image(7), sessionId: 3 });

    expect(await pending).toEqual([new Uint8Array([7])]);
  });
});
