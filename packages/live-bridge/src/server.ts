import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * アダプタ（Node で動く）が流す生 H.264 を、画面（webview で動く）へ渡す。
 *
 * **なぜ HTTP か**: スパイクで実測した経路をそのまま使える（ADR 0002）。Rust を書かずに済み、
 * `fetch` のストリームで読めるので受け手側に依存が要らない。
 *
 * **なぜ 127.0.0.1 に限るか**: ここを流れるのは**検証中の端末の画面**で、顧客名や電話番号が
 * 写る（PRD §10）。外から届く口にしない。
 *
 * **なぜ URL に無作為の文字列を入れるか**: 同じ PC の別のプロセスから、当てずっぽうで
 * 画面を覗けないようにするため。localhost なら安全、ではない。
 */

export interface LiveBridge {
  /** 画面側が読む URL。無作為の文字列を含む。 */
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

export interface LiveBridgeOptions {
  /** 流すもの。読み手が繋いだ時点で 1 回だけ呼ばれる。 */
  readonly source: () => AsyncIterable<Uint8Array>;
  /** 0 なら空いている口を OS に選ばせる。 */
  readonly port?: number;
}

export async function startLiveBridge(options: LiveBridgeOptions): Promise<LiveBridge> {
  const token = randomBytes(16).toString('hex');
  const path = `/live/${token}.h264`;

  const server: Server = createServer((req, res) => {
    if (req.url !== path) {
      // 何があるかを漏らさない。存在するかどうかも答えない。
      res.writeHead(404);
      res.end();
      return;
    }

    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
      // 途中で溜め込ませない。溜まると、測っているのが自分の遅延でなくなる。
      'x-accel-buffering': 'no',
    });

    void (async () => {
      try {
        for await (const chunk of options.source()) {
          if (res.writableEnded) return;
          res.write(chunk);
        }
      } catch {
        // 送り元が落ちたら、繋ぎっぱなしにせず切る。読み手は繋ぎ直しで復帰できる。
      } finally {
        res.end();
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(address.port)}${path}`,
    port: address.port,
    async close() {
      // 繋ぎっぱなしの読み手がいても閉じる。放っておくと終われない。
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
