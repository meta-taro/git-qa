import { describe, expect, it } from 'vitest';

import { encodeFrame } from '@git-qa/core';

import { encodeFrames, mjpegFrames } from '../src/frames.js';

/**
 * **映像を、画面が読める形で流す**（2026-10-07）。
 *
 * 画面の側（`image-frames`）は、**長さで包んだ絵**（`encodeFrame`）しか読めない。
 * iOS は JPEG をそのまま流していたので、**アプリの画面では映らなかった**（無人で流すときは映像を使わないので、表に出なかった）。
 */
const jpeg = (fill: number, size = 6): Uint8Array =>
  new Uint8Array([0xff, 0xd8, ...new Array<number>(size).fill(fill), 0xff, 0xd9]);

async function* chunks(...parts: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const one of parts) yield await Promise.resolve(one);
}

const collect = async (source: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> => {
  const out: Uint8Array[] = [];
  for await (const one of source) out.push(one);
  return out;
};

describe('encodeFrames', () => {
  it('絵 1 枚ずつを、長さで包む', async () => {
    const got = await collect(encodeFrames(chunks(jpeg(1), jpeg(2))));

    expect(got).toEqual([encodeFrame(jpeg(1)), encodeFrame(jpeg(2))]);
  });
});

/**
 * **WebDriverAgent の映像の口（MJPEG）を、絵 1 枚ずつに切る**（Windows からも読める・ネットワーク越し）。
 * 区切りは各部の `Content-Length`。**途中で切れて届いても、2 枚が 1 回で届いても切れる。**
 */
describe('mjpegFrames', () => {
  const part = (body: Uint8Array): Uint8Array => {
    const head = new TextEncoder().encode(
      `--BoundaryString\r\nContent-type: image/jpg\r\nContent-Length: ${String(body.length)}\r\n\r\n`,
    );
    const out = new Uint8Array(head.length + body.length + 2);
    out.set(head, 0);
    out.set(body, head.length);
    out.set([13, 10], head.length + body.length);
    return out;
  };

  it('部ごとの長さで切る', async () => {
    const got = await collect(mjpegFrames(chunks(part(jpeg(1)), part(jpeg(2)))));

    expect(got).toEqual([jpeg(1), jpeg(2)]);
  });

  /** **実物の WebDriverAgent は、絵のあとに空の改行を 2 つ置く**（2026-10-07・実物の 10 秒分で踏んだ）。 */
  it('絵のあとに空の改行が続いても、次の区切りを見失わない', async () => {
    const blank = new TextEncoder().encode('\r\n\r\n');
    const got = await collect(mjpegFrames(chunks(part(jpeg(5)), blank, part(jpeg(6)))));

    expect(got).toEqual([jpeg(5), jpeg(6)]);
  });

  it('途中で切れて届いても、つないで切る', async () => {
    const whole = new Uint8Array([...part(jpeg(3)), ...part(jpeg(4))]);
    const got = await collect(
      mjpegFrames(chunks(whole.subarray(0, 20), whole.subarray(20, 51), whole.subarray(51))),
    );

    expect(got).toEqual([jpeg(3), jpeg(4)]);
  });
});
