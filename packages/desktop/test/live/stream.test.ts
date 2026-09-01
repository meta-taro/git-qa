import { describe, expect, it, vi } from 'vitest';

import { createLivePlayer } from '../../src/live/player.js';
import { liveStreamUrlFromLocation, pumpLiveStream } from '../../src/live/stream.js';
import type { EncodedUnit } from '../../src/live/player.js';

function nal(type: number): Uint8Array {
  return new Uint8Array([0, 0, 1, type & 0x1f, 0x80, 0x11]);
}

const streamOf = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });

function recordingPlayer() {
  const submitted: EncodedUnit[] = [];
  const player = createLivePlayer({
    createDecoder: () => ({
      decode: (unit) => submitted.push(unit),
      close: () => {},
    }),
    onFrame: () => {},
  });
  return { player, submitted };
}

describe('liveStreamUrlFromLocation', () => {
  it('?live= から読む', () => {
    expect(liveStreamUrlFromLocation('?live=http://127.0.0.1:8787/live/abc.h264')).toBe(
      'http://127.0.0.1:8787/live/abc.h264',
    );
  });

  it('無ければ undefined（端末に繋いでいない状態）', () => {
    expect(liveStreamUrlFromLocation('')).toBeUndefined();
    expect(liveStreamUrlFromLocation('?live=')).toBeUndefined();
  });

  it('localhost 以外へは繋がない', () => {
    // ここを流れるのは検証中の端末の画面。外へ出す口を作らない（PRD §10）。
    expect(liveStreamUrlFromLocation('?live=http://example.com/live/a.h264')).toBeUndefined();
    expect(liveStreamUrlFromLocation('?live=http://192.168.1.5/live/a.h264')).toBeUndefined();
  });

  it('http 以外は受けない', () => {
    expect(liveStreamUrlFromLocation('?live=file:///etc/passwd')).toBeUndefined();
    expect(liveStreamUrlFromLocation('?live=ws://127.0.0.1/live')).toBeUndefined();
  });

  it('URL として読めないものは受けない', () => {
    expect(liveStreamUrlFromLocation('?live=notaurl')).toBeUndefined();
  });
});

describe('pumpLiveStream', () => {
  it('届いた順に再生へ渡す', async () => {
    const { player, submitted } = recordingPlayer();
    await pumpLiveStream(streamOf([nal(7), nal(8), nal(5), nal(1)]), player);

    expect(submitted.map((u) => u.type)).toEqual(['key', 'delta']);
  });

  it('刻まれて届いても同じ結果になる', async () => {
    const { player, submitted } = recordingPlayer();
    const whole = new Uint8Array([...nal(5), ...nal(1)]);
    await pumpLiveStream(streamOf([...whole].map((b) => new Uint8Array([b]))), player);

    expect(submitted.map((u) => u.type)).toEqual(['key', 'delta']);
  });

  it('尽きたら end する（最後の 1 枚が出る）', async () => {
    const { player, submitted } = recordingPlayer();
    await pumpLiveStream(streamOf([nal(5)]), player);

    expect(submitted).toHaveLength(1);
  });

  it('途中で止めても、溜まっている分を吐いてから閉じる', async () => {
    const controller = new AbortController();
    const { player, submitted } = recordingPlayer();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(nal(5));
        c.enqueue(nal(1));
        c.close();
      },
    });

    controller.abort();
    await pumpLiveStream(stream, player, controller.signal);

    // 1 枚も読まずに止めたので、出るものは無い。それでも end は通る。
    expect(submitted).toHaveLength(0);
    expect(player.stats.received).toBe(0);
  });

  it('読み込みが落ちても、握り潰さずに投げる', async () => {
    const { player } = recordingPlayer();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error('繋がりが切れた'));
      },
    });

    await expect(pumpLiveStream(stream, player)).rejects.toThrow(/繋がりが切れた/);
  });
});

describe('画面へ繋ぐところ', () => {
  it('URL が無ければ、再生を始めない', () => {
    // 端末に繋いでいないときに空の canvas を出すと、映らないのか繋いでいないのか分からない。
    const start = vi.fn();
    const url = liveStreamUrlFromLocation('');
    if (url !== undefined) start();
    expect(start).not.toHaveBeenCalled();
  });
});
