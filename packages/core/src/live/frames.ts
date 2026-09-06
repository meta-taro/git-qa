/**
 * 画像 1 枚ずつを運ぶための包み（ウェブ検証・C54）。
 *
 * Android は生 H.264 を流し、受け手が Annex-B の区切りで切る（`annexb.ts`）。
 * **ブラウザから来るのは画像 1 枚ずつ**（`Page.screencastFrame`）なので、そこに区切りが無い。
 *
 * 橋（`@git-qa/live-bridge`）は中身を知らずにバイト列を運ぶだけで、**届く単位は保証しない。**
 * 途中で切れて届くし、2 枚が 1 回で届くこともある。だから**長さを先に書いて包む。**
 */

/** 長さを書く場所（バイト）。4 バイトあれば 1 枚の絵には足りる。 */
const HEADER_BYTES = 4;

/**
 * 1 枚あたりの上限。**壊れた長さで待ち続けないための歯止め。**
 *
 * 途中から繋いだ読み手は、絵の真ん中から受け取ることがある。そこを長さとして読むと、
 * 来ないバイトを待って**永久に何も出さない**（人から見ると、映像が止まったのと同じ）。
 */
const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** 1 枚を包む。**空は包まない**（受け手が「1 枚来た」と誤解する）。 */
export function encodeFrame(image: Uint8Array): Uint8Array {
  if (image.byteLength === 0) throw new Error('空の絵は包めない');

  const out = new Uint8Array(HEADER_BYTES + image.byteLength);
  new DataView(out.buffer).setUint32(0, image.byteLength);
  out.set(image, HEADER_BYTES);
  return out;
}

export interface FrameSplitterOptions {
  readonly maxFrameBytes?: number;
}

export interface FrameSplitter {
  /** 届いたぶんを渡し、**揃った絵だけ**を受け取る。揃っていなければ空。 */
  push(chunk: Uint8Array): Uint8Array[];
}

export function createFrameSplitter(options: FrameSplitterOptions = {}): FrameSplitter {
  const max = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  let buffered = new Uint8Array(0);

  return {
    push(chunk) {
      if (chunk.byteLength > 0) {
        const next = new Uint8Array(buffered.byteLength + chunk.byteLength);
        next.set(buffered);
        next.set(chunk, buffered.byteLength);
        buffered = next;
      }

      const images: Uint8Array[] = [];
      for (;;) {
        if (buffered.byteLength < HEADER_BYTES) break;

        const size = new DataView(
          buffered.buffer,
          buffered.byteOffset,
          buffered.byteLength,
        ).getUint32(0);
        if (size === 0 || size > max) {
          // **黙って待たない。**待ち続けると、映像が止まった理由が誰にも分からなくなる。
          throw new Error(`絵の長さがありえない（${String(size)} バイト・上限 ${String(max)}）`);
        }
        if (buffered.byteLength < HEADER_BYTES + size) break;

        images.push(buffered.slice(HEADER_BYTES, HEADER_BYTES + size));
        buffered = buffered.slice(HEADER_BYTES + size);
      }
      return images;
    },
  };
}
