import { describe, expect, it } from 'vitest';

import { createAnnexBSplitter } from '../../src/live/annexb.js';

/**
 * NAL を 1 つ組み立てる。
 *
 * @param type NAL の種別（1=非 IDR スライス / 5=IDR / 6=SEI / 7=SPS / 8=PPS / 9=AUD）
 * @param first スライスのとき、フレームの先頭か（first_mb_in_slice が 0 か）
 * @param long 4 バイトの開始コードにするか
 */
function nal(type: number, first = true, long = false): Uint8Array {
  const start = long ? [0, 0, 0, 1] : [0, 0, 1];
  // ヘッダの次のバイトの最上位ビットが first_mb_in_slice == 0 を表す。
  const payload = [first ? 0x80 : 0x40, 0x11, 0x22];
  return new Uint8Array([...start, type & 0x1f, ...payload]);
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

describe('createAnnexBSplitter', () => {
  it('スライス 1 本ぶんを 1 枚として切る', () => {
    const s = createAnnexBSplitter();
    // **枚が確定するのは次の開始コードが来たとき。**最後の 1 枚は flush で出る。
    expect(s.push(nal(1))).toHaveLength(0);
    expect(s.flush()).toHaveLength(1);
  });

  it('先頭スライスが 2 本来たら 2 枚になる', () => {
    const s = createAnnexBSplitter();
    s.push(bytes(nal(1), nal(1)));
    expect(s.flush()).toHaveLength(2);
  });

  it('IDR を含む枚は key として出る', () => {
    const s = createAnnexBSplitter();
    s.push(bytes(nal(7), nal(8), nal(5)));
    const [unit] = s.flush();
    expect(unit?.isKey).toBe(true);
  });

  it('IDR を含まない枚は key ではない', () => {
    const s = createAnnexBSplitter();
    s.push(nal(1));
    expect(s.flush()[0]?.isKey).toBe(false);
  });

  /** スパイクで踏んだバグ その 1。 */
  it('1 フレームが複数スライスに割れていても、1 枚として数える', () => {
    const s = createAnnexBSplitter();
    // 先頭スライス + 続きのスライス 2 本 → これで 1 枚
    const frame1 = bytes(nal(1, true), nal(1, false), nal(1, false));
    s.push(frame1);
    s.push(nal(1, true));
    const out = s.flush();

    expect(out).toHaveLength(2);
    // 割れた 3 本が 1 枚にまとまっていること。ここを取り違えると、
    // 1 枚に満たない塊を復号器へ渡して落ちる。
    expect(out[0]?.bytes).toEqual(frame1);
  });

  /** スパイクで踏んだバグ その 2。Chromium は通すが WebKit は落ちる。 */
  it('パラメータセットは次の枚の先頭に付く。前の枚の末尾にぶら下げない', () => {
    const s = createAnnexBSplitter();
    // [frame1 のスライス][SPS][PPS][IDR] という実際の並び
    const out = [...s.push(bytes(nal(1), nal(7), nal(8), nal(5))), ...s.flush()];

    expect(out).toHaveLength(2);
    // 1 枚目はスライスだけ。SPS / PPS がぶら下がっていない。
    expect(out[0]?.bytes).toEqual(nal(1));
    expect(out[0]?.isKey).toBe(false);
    // 2 枚目が SPS + PPS + IDR。
    expect(out[1]?.bytes).toEqual(bytes(nal(7), nal(8), nal(5)));
    expect(out[1]?.isKey).toBe(true);
  });

  it('AUD と SEI も次の枚の先頭として扱う', () => {
    const s = createAnnexBSplitter();
    const out = [...s.push(bytes(nal(1), nal(9), nal(6), nal(1))), ...s.flush()];
    expect(out).toHaveLength(2);
    expect(out[0]?.bytes).toEqual(nal(1));
  });

  it('4 バイトの開始コードでも同じに切れる', () => {
    const s = createAnnexBSplitter();
    const out = [...s.push(bytes(nal(1, true, true), nal(1, true, true))), ...s.flush()];
    expect(out).toHaveLength(2);
  });

  it('開始コードを跨いで chunk が切れても取りこぼさない', () => {
    // ネットワークから来る以上、どこで切れるかは選べない。
    const whole = bytes(nal(1), nal(5), nal(1));
    for (let cut = 1; cut < whole.length; cut += 1) {
      const s = createAnnexBSplitter();
      const out = [...s.push(whole.slice(0, cut)), ...s.push(whole.slice(cut)), ...s.flush()];
      expect(out.map((u) => u.isKey)).toEqual([false, true, false]);
    }
  });

  it('1 バイトずつ流し込んでも同じ結果になる', () => {
    const whole = bytes(nal(7), nal(8), nal(5), nal(1));
    const s = createAnnexBSplitter();
    const out = [];
    for (const b of whole) out.push(...s.push(new Uint8Array([b])));
    out.push(...s.flush());
    expect(out.map((u) => u.isKey)).toEqual([true, false]);
  });

  it('開始コードがまだ来ていない間は何も出さない', () => {
    const s = createAnnexBSplitter();
    expect(s.push(new Uint8Array([0x00, 0x00]))).toHaveLength(0);
  });

  it('flush を呼ばないと最後の 1 枚が出ない', () => {
    // スパイクは flush を持っておらず、末尾が出ないままだった。
    const s = createAnnexBSplitter();
    expect(s.push(nal(5))).toHaveLength(0);
    expect(s.flush()).toHaveLength(1);
  });

  it('空のまま flush しても落ちない', () => {
    expect(createAnnexBSplitter().flush()).toEqual([]);
  });
});
