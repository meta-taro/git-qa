import { describe, expect, it } from 'vitest';

import { createLivePlayer } from '../../src/live/player.js';
import type { DecodedFrame, DecoderHandlers, EncodedUnit } from '../../src/live/player.js';

function nal(type: number, first = true): Uint8Array {
  return new Uint8Array([0, 0, 1, type & 0x1f, first ? 0x80 : 0x40, 0x11]);
}

const bytes = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** 復号器の代わり。**渡されたものをそのまま絵として返す**（中身は復号しない）。 */
function fakeDecoder(options: { failOn?: number; throwOn?: number } = {}) {
  const submitted: EncodedUnit[] = [];
  const closedFrames: number[] = [];
  let closed = false;
  let handlers: DecoderHandlers | undefined;

  const create = (h: DecoderHandlers) => {
    handlers = h;
    return {
      decode(unit: EncodedUnit) {
        submitted.push(unit);
        if (options.throwOn === submitted.length) throw new Error('decode で落ちた');
        if (options.failOn === submitted.length) {
          h.error(new Error('復号器が落ちた'));
          return;
        }
        const frame: DecodedFrame = {
          close: () => closedFrames.push(submitted.length),
        };
        h.output(frame);
      },
      close() {
        closed = true;
      },
    };
  };

  return {
    create,
    submitted,
    closedFrames,
    get closed() {
      return closed;
    },
    get handlers() {
      return handlers;
    },
  };
}

describe('createLivePlayer', () => {
  it('切り出した枚を、順に復号器へ渡す', () => {
    const d = fakeDecoder();
    const player = createLivePlayer({ createDecoder: d.create, onFrame: () => {} });
    player.push(bytes(nal(5), nal(1), nal(1)));
    player.end();

    expect(d.submitted.map((u) => u.type)).toEqual(['key', 'delta', 'delta']);
  });

  it('timestamp は fps に合わせて単調に増える', () => {
    // WebCodecs は timestamp が戻ると受け付けない。
    const d = fakeDecoder();
    const player = createLivePlayer({ createDecoder: d.create, onFrame: () => {}, fps: 60 });
    player.push(bytes(nal(1), nal(1), nal(1)));
    player.end();

    const ts = d.submitted.map((u) => u.timestamp);
    expect(ts).toEqual([0, 16667, 33334]);
  });

  it('絵は描いてから閉じる', () => {
    // 逆にすると、閉じた絵を描くことになる。
    const order: string[] = [];
    const d = fakeDecoder();
    const player = createLivePlayer({
      createDecoder: d.create,
      onFrame: () => order.push('draw'),
    });
    player.push(nal(5));
    player.end();

    expect(order).toEqual(['draw']);
    expect(d.closedFrames).toHaveLength(1);
  });

  it('受け取った枚数と描けた枚数を別々に数える', () => {
    // 同じ数にすると、詰まっていることが見えなくなる。
    const d = fakeDecoder({ failOn: 2 });
    const player = createLivePlayer({ createDecoder: d.create, onFrame: () => {} });
    player.push(bytes(nal(5), nal(1), nal(1)));
    player.end();

    expect(player.stats.received).toBe(3);
    expect(player.stats.painted).toBe(2);
  });

  it('最初の絵までの時間を残す', () => {
    let t = 1000;
    const d = fakeDecoder();
    const player = createLivePlayer({
      createDecoder: d.create,
      onFrame: () => {},
      now: () => t,
    });
    expect(player.stats.firstFrameMs).toBeUndefined();
    t = 1120;
    // 枚が確定するのは次の開始コードが来たときか end のとき。
    player.push(nal(5));
    player.end();
    expect(player.stats.firstFrameMs).toBe(120);
  });

  it('復号器が落ちた理由を残す。最初の 1 件だけ', () => {
    // 後から来る「閉じた復号器へ渡した」で覆われると、本当の原因が消える。
    const d = fakeDecoder({ failOn: 1 });
    const player = createLivePlayer({ createDecoder: d.create, onFrame: () => {} });
    player.push(nal(5));
    player.end();
    d.handlers?.error(new Error('あとから来た別の理由'));

    expect(player.stats.error).toBe('復号器が落ちた');
  });

  it('decode が例外を投げても、握り潰さず理由に残す', () => {
    const d = fakeDecoder({ throwOn: 1 });
    const player = createLivePlayer({ createDecoder: d.create, onFrame: () => {} });
    player.push(nal(5));
    player.end();

    expect(player.stats.error).toBe('decode で落ちた');
  });

  it('end で最後の 1 枚を吐いてから復号器を閉じる', () => {
    const d = fakeDecoder();
    const player = createLivePlayer({ createDecoder: d.create, onFrame: () => {} });
    player.push(nal(5));
    expect(d.submitted).toHaveLength(0);

    player.end();
    expect(d.submitted).toHaveLength(1);
    expect(d.closed).toBe(true);
  });

  it('end のあとに push しても何も起きない', () => {
    const d = fakeDecoder();
    const player = createLivePlayer({ createDecoder: d.create, onFrame: () => {} });
    player.end();
    player.push(nal(5));

    expect(d.submitted).toHaveLength(0);
  });

  it('end を二重に呼んでも復号器を二度閉じない', () => {
    let closes = 0;
    const player = createLivePlayer({
      createDecoder: () => ({ decode: () => {}, close: () => (closes += 1) }),
      onFrame: () => {},
    });
    player.end();
    player.end();

    expect(closes).toBe(1);
  });
});
