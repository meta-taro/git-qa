import { encodeFrame } from '@git-qa/core';

import type { CdpClient, CdpParams } from './cdp.js';

/**
 * ブラウザの画面を、1 枚ずつ受け取って流す（C54）。
 *
 * Android は `screenrecord` の生 H.264 を流していた。ブラウザは
 * `Page.screencastFrame` で**画像 1 枚ずつ + 受け取りの返事**という形なので、道が違う。
 *
 * **返事を返さないと次が来ない。**返し忘れると 1 枚で止まり、画面は最初の 1 枚のまま
 * 固まる。人から見ると「映像が止まった」で、原因としてはいちばん見つけにくい形。
 */

export interface ScreencastOptions {
  /** 画質（1〜100）。**落とすほど遅れが減る**（Android の bit-rate と同じ考え方・Issue 005）。 */
  readonly quality?: number;
  /** 1 枚ごとの最大の幅・高さ。大きいほど符号化と転送に時間がかかる。 */
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  /** 何枚に 1 枚送るか。既定は毎回。 */
  readonly everyNthFrame?: number;
}

export interface Screencast {
  /** 流れてくる絵。**長さを付けて包んである**（受け手は `createFrameSplitter` で切る）。 */
  frames(): AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

/** 既定値。**人が見て判断できる大きさで足りる**（大きいほど遅れる・Issue 005）。 */
const DEFAULT_QUALITY = 60;

export function createScreencast(cdp: CdpClient, options: ScreencastOptions = {}): Screencast {
  let stopListening: (() => void) | undefined;
  let started = false;

  const start = async (): Promise<void> => {
    if (started) return;
    started = true;
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: options.quality ?? DEFAULT_QUALITY,
      ...(options.maxWidth === undefined ? {} : { maxWidth: options.maxWidth }),
      ...(options.maxHeight === undefined ? {} : { maxHeight: options.maxHeight }),
      ...(options.everyNthFrame === undefined ? {} : { everyNthFrame: options.everyNthFrame }),
    });
  };

  const stop = async (): Promise<void> => {
    stopListening?.();
    stopListening = undefined;
    if (!started) return;
    started = false;
    // **流しっぱなしにしない。**読み手が去ってもブラウザは送り続ける。
    await cdp.send('Page.stopScreencast').catch(() => undefined);
  };

  return {
    frames(): AsyncIterable<Uint8Array> {
      return {
        async *[Symbol.asyncIterator]() {
          /** 受け取った順に溜める。読み手が遅れても順番を崩さない。 */
          const queue: Uint8Array[] = [];
          let wake: (() => void) | undefined;

          stopListening = cdp.on('Page.screencastFrame', (params: CdpParams) => {
            const data = params['data'];
            const sessionId = params['sessionId'];

            // **返事は先に返す。**絵が読めなくても、返さないと次が来なくなる。
            if (typeof sessionId === 'number') {
              void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
            }

            // 中身の無い通知は流さない。**空の絵を渡すと、受け手は壊れた絵を描く。**
            if (typeof data !== 'string' || data === '') return;
            queue.push(encodeFrame(new Uint8Array(Buffer.from(data, 'base64'))));
            wake?.();
          });

          await start();

          try {
            for (;;) {
              while (queue.length > 0) {
                yield queue.shift() as Uint8Array;
              }
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
              wake = undefined;
            }
          } finally {
            // 読み手が去った。**ブラウザにも止めてもらう。**
            await stop();
          }
        },
      };
    },

    close: stop,
  };
}
