import { codecFromAnnexB, createAnnexBSplitter } from '@git-qa/core/live';

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

/**
 * 復号器を作る。**codec は端末の SPS から決まる**ので、最初の 1 枚を見てから呼ぶ。
 * 固定にすると、端末の解像度が変わったときに 1 枚も復号できない（実機で真っ黒になった）。
 */
export type DecoderFactory = (handlers: DecoderHandlers, codec: string) => DecoderLike;

export interface LiveStats {
  /** ストリームから取り出した枚数。 */
  readonly received: number;
  /** 実際に描けた枚数。received との差が、詰まっている量。 */
  readonly painted: number;
  /** 最初の絵が出るまで（ms）。まだなら undefined。 */
  readonly firstFrameMs: number | undefined;
  /** 復号器が落ちた理由。落ちていなければ undefined。 */
  readonly error: string | undefined;
  /** 実際に使った codec。**端末の SPS から決まる。** */
  readonly codec: string | undefined;
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
  /** SPS が読めなかったときだけ使う codec。**普段は端末が名乗ったものを使う。** */
  readonly fallbackCodec?: string;
  /**
   * 何も来なくなってから、抱えている枚を吐くまでの待ち（ms）。
   *
   * **Annex-B は「次の絵が始まった」ことで前の絵の終わりを知る。**画面が静止していると
   * 次の絵が来ないので、待たせたままだと最初の 1 枚も出ない（実機で真っ黒になった）。
   */
  readonly idleFlushMs?: number;
  /** 待ちの仕掛け。差し替え口（検査で時計を進めるため）。 */
  readonly scheduleIdleFlush?: (run: () => void, delayMs: number) => () => void;
  readonly now?: () => number;
}

const DEFAULT_FPS = 60;

/** SPS が読めないときの逃げ道。Baseline / Level 3.0。 */
const FALLBACK_CODEC = 'avc1.42E01E';

/**
 * 静止した画面で、抱えている枚を出すまでの待ち。
 *
 * **短くしすぎない。**16 ms まで詰めたら、まだ届いている途中の絵を切って渡してしまい、
 * WebKit が `Decoder failure` を出して以後を受け付けなくなった（実機で 4 枚で止まった）。
 * ここは「送り手が本当に止まった」と言える長さにする。
 */
const DEFAULT_IDLE_FLUSH_MS = 80;

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
  let decoder: DecoderLike | undefined;
  let codec: string | undefined;

  /** 落ちた復号器は使い物にならない。**次の key で作り直す。** */
  let broken = false;

  const handlers: DecoderHandlers = {
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
      // **落ちたまま黙ると、画面が止まったように見える。**次の key で作り直す。
      broken = true;
    },
  };

  const submit = (unit: { bytes: Uint8Array; isKey: boolean }): void => {
    received += 1;

    if (broken) {
      // delta だけでは絵を組み立てられない。**key が来るまでは捨てる。**
      if (!unit.isKey) return;
      try {
        decoder?.close();
      } catch {
        // 既に閉じている。ここで落ちても、作り直しは続ける。
      }
      decoder = undefined;
      broken = false;
    }

    if (decoder === undefined) {
      // **端末が名乗った codec を使う。**決め打ちにすると、解像度で level が変わったときに
      // 1 枚も復号できないまま黙る（実機で真っ黒になった。端末は Level 5.0 だった）。
      // 名乗りが無い流れ（途中から繋いだ等）でだけ、既定へ落ちる。
      // 一度決めたら覚えておく。作り直しのときは key しか手元に無く、
      // そこから組み立て直すと既定へ落ちてしまう（同じ端末なので値は変わらない）。
      codec ??= codecFromAnnexB(unit.bytes) ?? options.fallbackCodec ?? FALLBACK_CODEC;
      decoder = options.createDecoder(handlers, codec);
    }

    try {
      decoder.decode({ type: unit.isKey ? 'key' : 'delta', timestamp, data: unit.bytes });
    } catch (error) {
      failure ??= error instanceof Error ? error.message : String(error);
    }
    timestamp += Math.round(1_000_000 / fps);
  };

  const idleFlushMs = options.idleFlushMs ?? DEFAULT_IDLE_FLUSH_MS;
  const schedule =
    options.scheduleIdleFlush ??
    ((run: () => void, delayMs: number): (() => void) => {
      const id = setTimeout(run, delayMs);
      return () => clearTimeout(id);
    });

  let cancelIdle: (() => void) | undefined;

  /** 何も来なくなったら、抱えている枚を吐く。**静止した画面でも絵を出すため。** */
  const armIdleFlush = (): void => {
    cancelIdle?.();
    cancelIdle = schedule(() => {
      cancelIdle = undefined;
      if (closed) return;
      for (const unit of splitter.flush()) submit(unit);
    }, idleFlushMs);
  };

  return {
    push(chunk) {
      if (closed) return;
      for (const unit of splitter.push(chunk)) submit(unit);
      armIdleFlush();
    },

    end() {
      if (closed) return;
      cancelIdle?.();
      cancelIdle = undefined;
      // flush を呼ばないと最後の 1 枚が出ない。
      for (const unit of splitter.flush()) submit(unit);
      closed = true;
      decoder?.close();
    },

    get stats(): LiveStats {
      return { received, painted, firstFrameMs, error: failure, codec };
    },
  };
}
