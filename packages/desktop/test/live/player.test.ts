import { describe, expect, it } from 'vitest';

import { createLivePlayer } from '../../src/live/player.js';
import type { DecodedFrame, DecoderHandlers, EncodedUnit } from '../../src/live/player.js';

function nal(type: number, first = true): Uint8Array {
  // SPS（種別 7）は、codec 文字列の材料（profile / constraint / level）を持つ。
  // **端末が名乗るまで復号器は作られない**ので、検査でも本物と同じ形にする。
  if ((type & 0x1f) === 7) return new Uint8Array([0, 0, 1, 0x67, 66, 0xc0, 50, 0x11]);
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

  const codecs: string[] = [];
  const create = (h: DecoderHandlers, codec: string) => {
    handlers = h;
    codecs.push(codec);
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
    codecs,
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

describe('createLivePlayer — codec は端末が名乗ったものを使う', () => {
  it('SPS から組み立てた codec で復号器を作る', () => {
    // **決め打ちにすると、解像度で level が変わったときに 1 枚も復号できない**
    // （実機で真っ黒になった。端末は Level 5.0、こちらは 3.0 固定だった）。
    const d = fakeDecoder();
    const player = createLivePlayer({ createDecoder: d.create, onFrame: () => {} });

    player.push(bytes(nal(7), nal(5)));
    player.end();

    expect(d.codecs).toEqual(['avc1.42c032']);
    expect(player.stats.codec).toBe('avc1.42c032');
  });

  it('名乗りが無ければ既定へ落ちる（途中から繋いだ場合）', () => {
    const d = fakeDecoder();
    const player = createLivePlayer({ createDecoder: d.create, onFrame: () => {} });

    player.push(bytes(nal(1)));
    player.end();

    expect(d.codecs).toEqual(['avc1.42E01E']);
  });
});

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
    // 2 枚目で落ちる。**落ちた後は key が来るまで捨てる**ので、描けたのは 1 枚。
    expect(player.stats.painted).toBe(1);
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
    // 復号器は最初の 1 枚が来たときに作られるので、先に流す。
    player.push(bytes(nal(7), nal(5)));
    player.end();
    player.end();

    expect(closes).toBe(1);
  });

  it('1 枚も来ないまま終わったら、復号器は作らない', () => {
    let created = 0;
    const player = createLivePlayer({
      createDecoder: () => {
        created += 1;
        return { decode: () => {}, close: () => {} };
      },
      onFrame: () => {},
    });

    player.end();

    expect(created).toBe(0);
  });
});

describe('createLivePlayer — 静止した画面でも最初の 1 枚を出す', () => {
  /**
   * **Annex-B は「次の絵が始まった」ことで前の絵の終わりを知る。**
   * 画面が静止していると次の絵が来ないので、最初の 1 枚を抱えたまま待ち続ける
   * （実機で真っ黒のままになった。160 KB 受け取って 0 枚だった）。
   */
  it('しばらく何も来なければ、抱えている枚を吐く', () => {
    const d = fakeDecoder();
    let fire: (() => void) | undefined;
    const player = createLivePlayer({
      createDecoder: d.create,
      onFrame: () => {},
      idleFlushMs: 80,
      scheduleIdleFlush: (run) => {
        fire = run;
        return () => {
          fire = undefined;
        };
      },
    });

    player.push(bytes(nal(7), nal(5)));
    expect(d.submitted).toHaveLength(0);

    fire?.();

    expect(d.submitted).toHaveLength(1);
    expect(d.submitted[0]?.type).toBe('key');
  });

  it('吐いた後にまた来ても、同じ枚を二度渡さない', () => {
    const d = fakeDecoder();
    let fire: (() => void) | undefined;
    const player = createLivePlayer({
      createDecoder: d.create,
      onFrame: () => {},
      scheduleIdleFlush: (run) => {
        fire = run;
        return () => {
          fire = undefined;
        };
      },
    });

    player.push(bytes(nal(7), nal(5)));
    fire?.();
    player.push(bytes(nal(1)));
    fire?.();

    expect(d.submitted).toHaveLength(2);
  });
});

describe('createLivePlayer — 復号器が落ちても立て直す', () => {
  /**
   * **落ちたまま黙ると、画面が止まったように見える**（実機で 4 枚で止まった）。
   * WebKit は壊れた 1 枚で `Decoder failure` を出して以後を受け付けない。
   * 次の key が来たら作り直す（delta だけでは絵を組み立てられないので、key を待つ）。
   */
  it('落ちた後、次の key で作り直して再生を続ける', () => {
    const d = fakeDecoder({ failOn: 2 });
    const player = createLivePlayer({ createDecoder: d.create, onFrame: () => {} });

    player.push(bytes(nal(7), nal(5)));
    player.push(bytes(nal(1)));
    // ここで落ちる。delta を渡し続けても直らない。
    player.push(bytes(nal(1)));
    expect(d.codecs).toHaveLength(1);

    // 次の key で作り直す。
    player.push(bytes(nal(5)));
    player.end();

    expect(d.codecs).toHaveLength(2);
    expect(d.codecs[1]).toBe('avc1.42c032');
  });

  it('落ちた理由は最初の 1 件を残す（作り直しで消さない）', () => {
    const d = fakeDecoder({ failOn: 2 });
    const player = createLivePlayer({ createDecoder: d.create, onFrame: () => {} });

    player.push(bytes(nal(7), nal(5)));
    player.push(bytes(nal(1)));
    player.push(bytes(nal(5)));
    player.end();

    expect(player.stats.error).toBe('復号器が落ちた');
  });
});
