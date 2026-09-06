import { createFrameSplitter } from '@git-qa/core/live';

/**
 * ブラウザの画面を描く（ウェブ検証・C54）。
 *
 * Android は H.264 を復号していた（`player.ts`）。ウェブから来るのは**画像 1 枚ずつ**なので、
 * 復号器は要らない —— 揃った 1 枚を絵にして描くだけ。
 *
 * **絵にする所は差し替えられるようにしてある。**本物のブラウザを使わずに、
 * 届き方（途中で切れる・2 枚まとめて来る・1 枚壊れている）を検査するため。
 */

export interface ImagePlayerOptions {
  /** バイト列を絵にする。既定は `createImageBitmap`。 */
  readonly decode: (bytes: Uint8Array) => Promise<ImageBitmap>;
  readonly onFrame: (frame: ImageBitmap) => void;
  /** 描けなかった理由。**黙って捨てない。** */
  readonly onError?: (message: string) => void;
  readonly maxFrameBytes?: number;
}

export interface ImagePlayer {
  push(chunk: Uint8Array): void;
  /** 流れの終わり。**H.264 の側と同じ名前**にしてある（同じ口へ渡せるように）。 */
  end(): void;
  /** 抱えている絵を描き終えるまで待つ（検査用）。 */
  idle(): Promise<void>;
  close(): void;
}

export function createImagePlayer(options: ImagePlayerOptions): ImagePlayer {
  const splitter = createFrameSplitter(
    options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes },
  );
  /** 描き終わるまでを繋ぐ。**順番を崩さない**（新しい絵が古い絵に上書きされないように）。 */
  let chain: Promise<void> = Promise.resolve();
  let closed = false;
  let latest: ImageBitmap | undefined;

  const draw = async (bytes: Uint8Array): Promise<void> => {
    if (closed) return;
    let frame: ImageBitmap;
    try {
      frame = await options.decode(bytes);
    } catch (error: unknown) {
      // **1 枚壊れただけで映像を終わらせない。**黒いままだと、人は繋がっていないと思う。
      options.onError?.(error instanceof Error ? error.message : String(error));
      return;
    }
    if (closed) {
      frame.close();
      return;
    }
    // 前の絵は用が済んでいる。**溜めると、絵の枚数ぶんだけ場所を取り続ける。**
    latest?.close();
    latest = frame;
    options.onFrame(frame);
  };

  return {
    push(chunk) {
      if (closed) return;
      let images: Uint8Array[];
      try {
        images = splitter.push(chunk);
      } catch (error: unknown) {
        // 長さがありえない。**黙って待たない**（待つと、止まった理由が誰にも分からない）。
        options.onError?.(error instanceof Error ? error.message : String(error));
        return;
      }
      for (const image of images) {
        chain = chain.then(() => draw(image));
      }
    },

    idle: () => chain,

    end() {
      closed = true;
      latest?.close();
      latest = undefined;
    },

    close() {
      closed = true;
      latest?.close();
      latest = undefined;
    },
  };
}
