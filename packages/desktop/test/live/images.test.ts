import { describe, expect, it, vi } from 'vitest';

import { encodeFrame } from '@git-qa/core/live';

import { createImagePlayer } from '../../src/live/images.js';

/**
 * ブラウザの画面を描く（ウェブ検証・C54）。
 *
 * Android は H.264 を復号していた。ウェブから来るのは**画像 1 枚ずつ**なので、
 * 復号器は要らない —— 代わりに「揃った 1 枚を絵にして描く」だけ。
 */

/** 絵にする所の代わり。**本物のブラウザを使わずに、届き方だけを見る。** */
const fakeDecode = (bytes: Uint8Array) =>
  Promise.resolve({ width: 4, height: 3, close: () => undefined, bytes } as unknown as ImageBitmap);

const image = (...values: number[]): Uint8Array => new Uint8Array(values);

describe('createImagePlayer', () => {
  it('揃った 1 枚を描く', async () => {
    const drawn: ImageBitmap[] = [];
    const player = createImagePlayer({ decode: fakeDecode, onFrame: (f) => drawn.push(f) });

    player.push(encodeFrame(image(1, 2)));
    await player.idle();

    expect(drawn).toHaveLength(1);
  });

  /** **半分の絵を描かない。**描くと、人は壊れたと思う。 */
  it('途中で切れて届いたら、揃うまで描かない', async () => {
    const drawn: ImageBitmap[] = [];
    const player = createImagePlayer({ decode: fakeDecode, onFrame: (f) => drawn.push(f) });
    const whole = encodeFrame(image(9, 8, 7));

    player.push(whole.slice(0, 3));
    await player.idle();
    expect(drawn).toHaveLength(0);

    player.push(whole.slice(3));
    await player.idle();
    expect(drawn).toHaveLength(1);
  });

  it('1 回で 2 枚届いたら、2 枚とも描く', async () => {
    const drawn: ImageBitmap[] = [];
    const player = createImagePlayer({ decode: fakeDecode, onFrame: (f) => drawn.push(f) });

    player.push(new Uint8Array([...encodeFrame(image(1)), ...encodeFrame(image(2))]));
    await player.idle();

    expect(drawn).toHaveLength(2);
  });

  /**
   * **絵にできない 1 枚で、映像を終わらせない。**
   * 1 枚壊れただけで黒いままになると、人は繋がっていないと思う。
   */
  it('絵にできない 1 枚は飛ばして、次から描き続ける', async () => {
    const drawn: ImageBitmap[] = [];
    const failures: string[] = [];
    let first = true;
    const player = createImagePlayer({
      decode: (bytes) => {
        if (first) {
          first = false;
          return Promise.reject(new Error('壊れた絵'));
        }
        return fakeDecode(bytes);
      },
      onFrame: (f) => drawn.push(f),
      onError: (message) => failures.push(message),
    });

    player.push(encodeFrame(image(1)));
    await player.idle();
    player.push(encodeFrame(image(2)));
    await player.idle();

    expect(drawn).toHaveLength(1);
    // **黙って捨てない。**何枚落としたのかは、後から原因を絞るのに要る。
    expect(failures[0]).toMatch(/壊れた絵/);
  });

  it('長さがありえない流れは、理由を出して止める（黙って待たない）', async () => {
    const failures: string[] = [];
    const player = createImagePlayer({
      decode: fakeDecode,
      onFrame: () => undefined,
      onError: (message) => failures.push(message),
      maxFrameBytes: 8,
    });

    player.push(new Uint8Array([0, 0, 0, 200, 1, 2]));
    await player.idle();

    expect(failures[0]).toMatch(/長さ/);
  });

  it('閉じたら、抱えている絵を捨てる', async () => {
    const close = vi.fn();
    const player = createImagePlayer({
      decode: () => Promise.resolve({ width: 1, height: 1, close } as unknown as ImageBitmap),
      onFrame: () => undefined,
    });

    player.push(encodeFrame(image(1)));
    await player.idle();
    player.close();

    expect(close).toHaveBeenCalled();
  });
});
