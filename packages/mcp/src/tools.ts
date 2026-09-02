import type { TargetSession } from '@git-qa/core';
import { screenText as textFromDump } from '@git-qa/adapter-android';

/**
 * 端末を触り、画面を取るための道具。**AI（MCP の向こう側）が使う。**
 *
 * **判定を置く道具は無い。**`VERIFIED` を AI が置けるようにした瞬間、この製品の芯
 * （人が見て保証したことが証跡に残る・C1 / C17）が壊れる。
 * ここでできるのは端末の操作と画面の取得まで。**合否は人だけが置く。**
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Screenshot {
  readonly mimeType: 'image/png';
  readonly base64: string;
}

export interface DeviceTools {
  tap(x: number, y: number): Promise<void>;
  swipe(from: Point, to: Point, durationMs: number): Promise<void>;
  key(name: string): Promise<void>;
  screenshot(): Promise<Screenshot>;
  screenText(): Promise<string>;
  screenSize(): Promise<{ width: number; height: number }>;
  close(): Promise<void>;
}

export interface DeviceToolsOptions {
  readonly connect: () => Promise<TargetSession>;
}

export function createDeviceTools(options: DeviceToolsOptions): DeviceTools {
  let session: TargetSession | undefined;

  /** 繋ぎ直さない。**毎回繋ぐと遅く、端末も掴み合う。** */
  const use = async (): Promise<TargetSession> => {
    session ??= await options.connect();
    return session;
  };

  return {
    async tap(x, y) {
      await (await use()).act({ kind: 'tap', target: { at: 'point', x, y } });
    },

    async swipe(from, to, durationMs) {
      await (
        await use()
      ).act({
        kind: 'swipe',
        from: { at: 'point', x: from.x, y: from.y },
        to: { at: 'point', x: to.x, y: to.y },
        durationMs,
      });
    },

    async key(name) {
      await (await use()).act({ kind: 'key', key: name });
    },

    async screenshot() {
      const shot = await (await use()).screenshot();
      return { mimeType: 'image/png', base64: Buffer.from(shot.bytes).toString('base64') };
    },

    async screenText() {
      const observation = await (await use()).observe();
      if (typeof observation.raw !== 'string') {
        // 握り潰さない。読めないまま空文字を返すと、無いのか読めないのかが分からない。
        throw new Error('画面の生データが uiautomator の XML ではない');
      }
      return textFromDump(observation.raw);
    },

    async screenSize() {
      const current = await use();
      const size = await current.screenSize?.();
      if (size === undefined) {
        throw new Error('この対象は画面の実寸を持たない');
      }
      return size;
    },

    async close() {
      const current = session;
      session = undefined;
      await current?.close();
    },
  };
}
