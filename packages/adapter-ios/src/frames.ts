import { encodeFrame } from '@git-qa/core';

/**
 * **絵 1 枚ずつを、画面が読める形（長さで包む）にする**（2026-10-07）。
 *
 * 画面の側（`image-frames`）は `encodeFrame` で包んだ絵しか読めない。
 * iOS は JPEG をそのまま流していたので、**アプリの画面では映らなかった**。
 */
export async function* encodeFrames(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  for await (const one of source) {
    if (one.length > 0) yield encodeFrame(one);
  }
}

const HEADER_END = new Uint8Array([13, 10, 13, 10]);
const LENGTH = /content-length:\s*(\d+)/i;

/** `haystack` の中で `needle` が始まる位置。無ければ -1。 */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * **WebDriverAgent の映像の口（MJPEG）を、絵 1 枚ずつに切る**（2026-10-07）。
 *
 * 網越しの HTTP なので、**USB で映す道具が無い OS（Windows）でも読める。**
 * 区切りは各部の `Content-Length`。途中で切れて届いても、2 枚が 1 回で届いても切れる。
 * **長さが読めない部は捨てずに止まる**（境界を見失ったまま読み進めない）。
 */
export async function* mjpegFrames(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  let held = new Uint8Array(0);
  for await (const chunk of source) {
    const next = new Uint8Array(held.length + chunk.length);
    next.set(held, 0);
    next.set(chunk, held.length);
    held = next;

    for (;;) {
      // **部と部の間の空の改行を読み飛ばす。**実物の WDA は絵のあとに `\r\n\r\n` を置く。
      // 読み飛ばさないと、その空行を「見出しの終わり」と取り違える（2026-10-07・実物で踏んだ）。
      let skip = 0;
      while (skip < held.length && (held[skip] === 13 || held[skip] === 10)) skip += 1;
      if (skip > 0) held = held.subarray(skip);
      const end = indexOfBytes(held, HEADER_END);
      if (end < 0) break;
      const head = new TextDecoder().decode(held.subarray(0, end));
      const size = LENGTH.exec(head)?.[1];
      if (size === undefined) {
        throw new Error('映像の口の区切りが読めない（Content-Length が無い）');
      }
      const start = end + HEADER_END.length;
      const stop = start + Number(size);
      if (held.length < stop) break;
      // **写して渡す。**元の器を共有すると、継ぎ足したときに渡した絵が変わる。
      yield new Uint8Array(held.subarray(start, stop));
      held = held.subarray(stop);
    }
  }
}
