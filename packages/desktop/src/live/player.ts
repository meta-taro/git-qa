import { createAnnexBSplitter } from '@git-qa/core/live';

/**
 * ライブ映像の再生。**方式 A**（ストリームを取り込んで自前で描く・C27）の中身。
 *
 * 復号器は**注入する**。WebCodecs はブラウザの API で、engine ごとに癖がある
 * （macOS で実際に落ちた・ADR 0002）。ここを差し替えられないと、再生の筋道を
 * webview 無しで検査できない。
 */

/** 復号器へ渡す 1 枚ぶん。WebCodecs の EncodedVideoChunk に対応する。 */
export interface EncodedUnit {
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly data: Uint8Array;
}

/** 復号して出てきた絵。使い終わったら必ず close する（しないと復号器が詰まる）。 */
export interface DecodedFrame {
  close(): void;
  /** 実寸。WebCodecs の VideoFrame が持っている。無い実装もあるので任意。 */
  readonly displayWidth?: number;
  readonly displayHeight?: number;
}

export interface DecoderLike {
  decode(unit: EncodedUnit): void;
  close(): void;
}

export interface DecoderHandlers {
  readonly output: (frame: DecodedFrame) => void;
  readonly error: (error: Error) => void;
}

export type DecoderFactory = (handlers: DecoderHandlers) => DecoderLike;

export interface LiveStats {
  /** ストリームから取り出した枚数。 */
  readonly received: number;
  /** 実際に描けた枚数。received との差が、詰まっている量。 */
  readonly painted: number;
  /** 最初の絵が出るまで（ms）。まだなら undefined。 */
  readonly firstFrameMs: number | undefined;
  /** 復号器が落ちた理由。落ちていなければ undefined。 */
  readonly error: string | undefined;
}

export interface LivePlayer {
  push(chunk: Uint8Array): void;
  /** ストリームの終わり。残りを吐いてから復号器を閉じる。 */
  end(): void;
  readonly stats: LiveStats;
}

export interface LivePlayerOptions {
  readonly createDecoder: DecoderFactory;
  /** 描く先。絵は呼び出し側が close する前に使い切ること。 */
  readonly onFrame: (frame: DecodedFrame) => void;
  /** 送り手の fps。timestamp の刻みに使う。 */
  readonly fps?: number;
  readonly now?: () => number;
}

const DEFAULT_FPS = 60;

export function createLivePlayer(options: LivePlayerOptions): LivePlayer {
  const fps = options.fps ?? DEFAULT_FPS;
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const splitter = createAnnexBSplitter();

  let received = 0;
  let painted = 0;
  let firstFrameMs: number | undefined;
  let failure: string | undefined;
  let timestamp = 0;
  let closed = false;

  const decoder = options.createDecoder({
    output: (frame) => {
      // 描いてから close する。逆にすると、閉じた絵を描くことになる。
      options.onFrame(frame);
      frame.close();
      painted += 1;
      firstFrameMs ??= now() - startedAt;
    },
    error: (error) => {
      // 握り潰さない。**最初の 1 件だけ残す** — 後から来る「閉じた復号器へ渡した」で
      // 覆われると、本当の原因が消える（スパイクで踏んだ）。
      failure ??= error.message;
    },
  });

  const submit = (unit: { bytes: Uint8Array; isKey: boolean }): void => {
    received += 1;
    try {
      decoder.decode({ type: unit.isKey ? 'key' : 'delta', timestamp, data: unit.bytes });
    } catch (error) {
      failure ??= error instanceof Error ? error.message : String(error);
    }
    timestamp += Math.round(1_000_000 / fps);
  };

  return {
    push(chunk) {
      if (closed) return;
      for (const unit of splitter.push(chunk)) submit(unit);
    },

    end() {
      if (closed) return;
      // flush を呼ばないと最後の 1 枚が出ない。
      for (const unit of splitter.flush()) submit(unit);
      closed = true;
      decoder.close();
    },

    get stats(): LiveStats {
      return { received, painted, firstFrameMs, error: failure };
    },
  };
}
