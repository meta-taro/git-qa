import { describe, expect, it } from 'vitest';

import { codecFromAnnexB } from '../../src/live/codec.js';

/**
 * 端末が吐いた SPS から codec 文字列を組み立てる。
 *
 * **固定にしてはいけない。**端末の解像度で level が変わり、食い違うと
 * 復号器が 1 枚も返さない（実機で真っ黒になった。端末は Level 5.0、こちらは 3.0 固定だった）。
 */

/** `00 00 01` + NAL 種別 + 3 バイト（profile / constraint / level）。 */
const sps = (profile: number, constraint: number, level: number): Uint8Array =>
  new Uint8Array([0, 0, 1, 0x67, profile, constraint, level, 0x00]);

describe('codecFromAnnexB', () => {
  it('SPS の 3 バイトから組み立てる', () => {
    expect(codecFromAnnexB(sps(66, 0xc0, 50))).toBe('avc1.42c032');
  });

  it('High profile でも組み立てられる', () => {
    expect(codecFromAnnexB(sps(100, 0x00, 40))).toBe('avc1.640028');
  });

  it('4 バイトの開始コードでも読める', () => {
    const bytes = new Uint8Array([0, 0, 0, 1, 0x67, 66, 0xc0, 50, 0x00]);
    expect(codecFromAnnexB(bytes)).toBe('avc1.42c032');
  });

  it('SPS が無ければ undefined（勝手に決めない）', () => {
    const noSps = new Uint8Array([0, 0, 1, 0x65, 1, 2, 3, 4]);
    expect(codecFromAnnexB(noSps)).toBeUndefined();
  });

  it('途中で切れていたら undefined', () => {
    expect(codecFromAnnexB(new Uint8Array([0, 0, 1, 0x67, 66]))).toBeUndefined();
  });
});
