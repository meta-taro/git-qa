import { describe, expect, it } from 'vitest';

import { createFrameSplitter, encodeFrame } from '../../src/live/frames.js';

/**
 * 画像 1 枚ずつを運ぶための包み（ウェブ検証・C54）。
 *
 * Android は生 H.264 を流し、受け手が Annex-B の区切りで切っていた。
 * **ブラウザから来るのは画像 1 枚ずつ**（`Page.screencastFrame`）なので、区切りが要る。
 *
 * 橋（`@git-qa/live-bridge`）は中身を知らずにバイト列を運ぶだけで、**届く単位は保証しない。**
 * 途中で切れて届くし、2 枚が 1 回で届くこともある。**長さを先に書いて包む。**
 */

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('encodeFrame', () => {
  it('長さを先に書いてから中身を置く', () => {
    expect([...encodeFrame(bytes(0xff, 0xd8, 0xd9))]).toEqual([0, 0, 0, 3, 0xff, 0xd8, 0xd9]);
  });

  it('空の絵は包まない（受け手が「1 枚来た」と誤解する）', () => {
    expect(() => encodeFrame(new Uint8Array())).toThrow(/空/);
  });
});

describe('createFrameSplitter', () => {
  it('1 回で届いた 1 枚を出す', () => {
    const splitter = createFrameSplitter();

    expect(splitter.push(encodeFrame(bytes(1, 2, 3)))).toEqual([bytes(1, 2, 3)]);
  });

  it('1 回で 2 枚届いても、2 枚として出す', () => {
    const splitter = createFrameSplitter();
    const chunk = new Uint8Array([...encodeFrame(bytes(1)), ...encodeFrame(bytes(2, 3))]);

    expect(splitter.push(chunk)).toEqual([bytes(1), bytes(2, 3)]);
  });

  /** **途中で切れて届く。**揃うまで出さない —— 半分の絵を描くと、人は壊れたと思う。 */
  it('途中で切れて届いたら、揃うまで出さない', () => {
    const splitter = createFrameSplitter();
    const whole = encodeFrame(bytes(9, 8, 7));

    expect(splitter.push(whole.slice(0, 2))).toEqual([]);
    expect(splitter.push(whole.slice(2, 5))).toEqual([]);
    expect(splitter.push(whole.slice(5))).toEqual([bytes(9, 8, 7)]);
  });

  it('長さの途中で切れても待てる', () => {
    const splitter = createFrameSplitter();
    const whole = encodeFrame(bytes(4, 5));

    expect(splitter.push(whole.slice(0, 1))).toEqual([]);
    expect(splitter.push(whole.slice(1))).toEqual([bytes(4, 5)]);
  });

  it('何も来なければ何も出さない', () => {
    expect(createFrameSplitter().push(new Uint8Array())).toEqual([]);
  });

  /**
   * **壊れた長さで待ち続けない。**途中から繋いだ読み手は、絵の真ん中から受け取る。
   * そこを長さとして読むと、来ないバイトを待って**永久に何も出さなくなる**。
   */
  it('ありえない長さが来たら、待たずに落とす', () => {
    const splitter = createFrameSplitter({ maxFrameBytes: 8 });

    expect(() => splitter.push(bytes(0, 0, 0, 200, 1, 2))).toThrow(/長さ/);
  });
});
