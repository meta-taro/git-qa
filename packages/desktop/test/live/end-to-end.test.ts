import { describe, expect, it } from 'vitest';

import { startLiveBridge } from '@git-qa/live-bridge';

import { createLivePlayer } from '../../src/live/player.js';
import { openLiveStream, pumpLiveStream } from '../../src/live/stream.js';
import type { DecodedFrame, EncodedUnit } from '../../src/live/player.js';

/**
 * **送り手（Node）と受け手（webview 側のコード）が実際に繋がるか。**
 *
 * 片方ずつの検査は通っていても、繋いだ途端に映らないことがある。
 * ここは本物の HTTP を通す（127.0.0.1）。端末は要らない。
 */

function nal(type: number, first = true): Uint8Array {
  return new Uint8Array([0, 0, 1, type & 0x1f, first ? 0x80 : 0x40, 0x11, 0x22]);
}

describe('橋を通した通し', () => {
  it('Node 側が流した生 H.264 が、画面側で枚として復号まで届く', async () => {
    // scrcpy / screenrecord が吐くのと同じ並び: [SPS][PPS][IDR] のあとに通常のスライス
    const wire = [new Uint8Array([...nal(7), ...nal(8), ...nal(5)]), nal(1), nal(1), nal(1)];

    const bridge = await startLiveBridge({
      source: async function* () {
        for (const chunk of wire) yield await Promise.resolve(chunk);
      },
    });

    const decoded: EncodedUnit[] = [];
    const drawn: DecodedFrame[] = [];
    const player = createLivePlayer({
      createDecoder: (handlers) => ({
        decode(unit) {
          decoded.push(unit);
          handlers.output({ close: () => {} });
        },
        close() {},
      }),
      onFrame: (frame) => drawn.push(frame),
    });

    try {
      await pumpLiveStream(await openLiveStream(bridge.url), player);
    } finally {
      await bridge.close();
    }

    // 1 枚目が key（IDR）で、以降が delta。ここが崩れると絵が出ない。
    expect(decoded.map((u) => u.type)).toEqual(['key', 'delta', 'delta', 'delta']);
    expect(player.stats.received).toBe(4);
    expect(player.stats.painted).toBe(4);
    expect(player.stats.error).toBeUndefined();
    expect(drawn).toHaveLength(4);
  });

  it('橋が無作為の道を使っていても、受け手はその URL で繋がる', async () => {
    const bridge = await startLiveBridge({
      source: async function* () {
        yield await Promise.resolve(nal(5));
      },
    });
    try {
      const stream = await openLiveStream(bridge.url);
      expect(stream).toBeInstanceOf(ReadableStream);
      await stream.cancel();
    } finally {
      await bridge.close();
    }
  });

  it('繋がらない URL は、握り潰さずに落ちる', async () => {
    const bridge = await startLiveBridge({
      source: async function* () {
        yield await Promise.resolve(nal(5));
      },
    });
    const origin = new URL(bridge.url).origin;
    try {
      await expect(openLiveStream(`${origin}/live/deadbeef.h264`)).rejects.toThrow(/404/);
    } finally {
      await bridge.close();
    }
  });
});
