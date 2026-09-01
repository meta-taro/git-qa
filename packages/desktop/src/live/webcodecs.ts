import type { DecoderHandlers, DecoderLike } from './player.js';

/**
 * ブラウザの WebCodecs を、`player.ts` が使う口へ合わせる薄い層。
 *
 * **ここは webview の中でしか動かないので、テストで検査していない。**
 * 検査できるようにするために、再生の筋道（`player.ts`）は復号器を注入する形にしてある。
 *
 * WebCodecs の型は TypeScript の DOM ライブラリにまだ入っていない。
 * 依存を足すほどの面積ではないので、使う分だけここで宣言する。
 */

interface EncodedChunkInit {
  type: 'key' | 'delta';
  timestamp: number;
  data: Uint8Array;
}

interface VideoDecoderInit {
  output: (frame: { close(): void }) => void;
  error: (error: DOMException) => void;
}

interface VideoDecoderConfig {
  codec: string;
  optimizeForLatency?: boolean;
}

declare class EncodedVideoChunk {
  constructor(init: EncodedChunkInit);
}

declare class VideoDecoder {
  constructor(init: VideoDecoderInit);
  configure(config: VideoDecoderConfig): void;
  decode(chunk: EncodedVideoChunk): void;
  close(): void;
  static isConfigSupported(config: VideoDecoderConfig): Promise<{ supported?: boolean }>;
}

/**
 * Baseline profile / Level 3.0。**`description` を渡さないと Annex-B として扱われる**ので、
 * 端末が吐いたストリームをそのまま食える（ADR 0002）。
 */
export const CODEC = 'avc1.42E01E';

/** この webview で H.264 を復号できるか。**engine ごとに違う**ので実行時に見る。 */
export async function isLiveViewSupported(): Promise<boolean> {
  if (typeof VideoDecoder === 'undefined') return false;
  const support = await VideoDecoder.isConfigSupported({ codec: CODEC });
  return support.supported === true;
}

export function createWebCodecsDecoder(handlers: DecoderHandlers): DecoderLike {
  const decoder = new VideoDecoder({
    output: (frame) => handlers.output(frame),
    error: (error) => handlers.error(new Error(error.message)),
  });
  // 遅延を優先する。溜めて滑らかにされると、人が見て判断する用途では逆効果になる。
  decoder.configure({ codec: CODEC, optimizeForLatency: true });

  return {
    decode(unit) {
      decoder.decode(new EncodedVideoChunk(unit));
    },
    close() {
      decoder.close();
    },
  };
}
