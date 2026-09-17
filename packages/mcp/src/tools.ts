import { mimeTypeOf } from '@git-qa/core';
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
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly base64: string;
}

export interface DeviceTools {
  tap(x: number, y: number): Promise<void>;
  /**
   * **名前で押す**（人の指示・2026-09-17）。
   *
   * 座標しか無いと、AI は**画面を読んで座標を当てにいく**しかない。
   * シートは「「保存」をクリックする」と書く —— **道具にも同じ口が要る。**
   *
   * **探し方はアダプタが持っている。**ここで別の探し方を作らない。
   */
  tapRef(ref: string): Promise<void>;
  swipe(from: Point, to: Point, durationMs: number): Promise<void>;
  key(name: string): Promise<void>;
  /** アプリを起動する。**`app` は端末側の識別子そのまま**（Android ならパッケージ名・C40）。 */
  launch(app: string): Promise<void>;
  type(text: string): Promise<void>;
  screenshot(): Promise<Screenshot>;
  screenText(): Promise<string>;
  screenSize(): Promise<{ width: number; height: number }>;
  close(): Promise<void>;
}

export interface DeviceToolsOptions {
  readonly connect: () => Promise<TargetSession>;
  /**
   * 画面の文字の読み方（人の指示・2026-09-17）。
   *
   * **相手ごとに違う。**Android は uiautomator の XML、ウェブは `innerText`、
   * デスクトップはアクセシビリティ＋OCR。**ここを固定すると、相手が 1 つに縛られる。**
   * 渡されなければ、今までどおり Android として読む。
   */
  readonly readScreenText?: (session: TargetSession) => Promise<string>;
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

    async tapRef(ref) {
      // **探し方はアダプタが持っている。**ここで別の探し方を作らない。
      await (await use()).act({ kind: 'tap', target: { at: 'element', ref } });
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

    async launch(app) {
      await (await use()).act({ kind: 'launch', app });
    },

    async type(text) {
      await (await use()).act({ kind: 'type', text });
    },

    async screenshot() {
      const shot = await (await use()).screenshot();
      // **名乗られた形をそのまま渡す。**png と決め打ちにすると、
      // JPEG を image/png として渡すことになる（2026-09-11 に実際に起きていた）。
      return {
        mimeType: mimeTypeOf(shot.format),
        base64: Buffer.from(shot.bytes).toString('base64'),
      };
    },

    async screenText() {
      const session = await use();
      // **相手ごとの読み方が渡されていれば、それを使う。**
      if (options.readScreenText !== undefined) return options.readScreenText(session);

      const observation = await session.observe();
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
