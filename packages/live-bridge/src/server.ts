import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * アダプタ（Node で動く）が流す生 H.264 を、画面（webview で動く）へ渡す。
 * **打鍵と実行状態も、同じ橋で往復させる。**
 *
 * **なぜ HTTP か**: スパイクで実測した経路をそのまま使える（ADR 0002）。Rust を書かずに済み、
 * `fetch` のストリームで読めるので受け手側に依存が要らない。
 *
 * **なぜ 127.0.0.1 に限るか**: ここを流れるのは**検証中の端末の画面**で、顧客名や電話番号が
 * 写る（PRD §10）。外から届く口にしない。
 *
 * **なぜ URL に無作為の文字列を入れるか**: 同じ PC の別のプロセスから、当てずっぽうで
 * 画面を覗けないようにするため。localhost なら安全、ではない。
 *
 * **なぜ制御チャネルを同じ橋に相乗りさせるか**: 口を 2 つに分けると、上の守りを 2 箇所で
 * 維持することになり、**片方だけ緩んでも気づけない。**
 */

export interface LiveBridge {
  /** 画面側が映像を読む URL。無作為の文字列を含む。 */
  readonly url: string;
  /** 状態を受け取り、打鍵を返す口。`<controlUrl>/events` と `<controlUrl>/input`。 */
  readonly controlUrl: string;
  readonly port: number;
  /** いまの実行状態を画面へ流す。**繋いでいる画面が無くても、最後の 1 つは覚えておく。** */
  publish(state: unknown): void;
  /** 画面から届いた打鍵を受ける。戻り値を呼ぶと解除できる。 */
  onInput(handler: (input: unknown) => void): () => void;
  close(): Promise<void>;
}

export interface LiveBridgeOptions {
  /** 流すもの。読み手が繋いだ時点で 1 回だけ呼ばれる。 */
  readonly source: () => AsyncIterable<Uint8Array>;
  /** 0 なら空いている口を OS に選ばせる。 */
  readonly port?: number;
}

/** 打鍵 1 回分。これより大きい本文は、この口へ来るものではない。 */
const MAX_INPUT_BYTES = 64 * 1024;

function writeVideo(res: ServerResponse, source: () => AsyncIterable<Uint8Array>): void {
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
    // 途中で溜め込ませない。溜まると、測っているのが自分の遅延でなくなる。
    'x-accel-buffering': 'no',
  });

  void (async () => {
    try {
      for await (const chunk of source()) {
        if (res.writableEnded) return;
        res.write(chunk);
      }
    } catch {
      // 送り元が落ちたら、繋ぎっぱなしにせず切る。読み手は繋ぎ直しで復帰できる。
    } finally {
      res.end();
    }
  })();
}

/** POST の本文を読む。**大きすぎるものは溜めない。** */
function readInput(
  req: IncomingMessage,
  res: ServerResponse,
  accept: (input: unknown) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;

  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) {
      if (!res.writableEnded) {
        res.writeHead(413).end();
      }
      // 溜めるのをやめる。読み捨てないと、送り手が書き終われない。
      chunks.length = 0;
      req.resume();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (res.writableEnded) return;
    try {
      accept(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      // 握り潰さない。読めない打鍵を「無かったこと」にすると、人は押したつもりで待ち続ける。
      res.writeHead(400).end();
      return;
    }
    res.writeHead(202).end();
  });
}

export async function startLiveBridge(options: LiveBridgeOptions): Promise<LiveBridge> {
  const token = randomBytes(16).toString('hex');
  const videoPath = `/live/${token}.h264`;
  const controlPath = `/live/${token}/control`;

  const viewers = new Set<ServerResponse>();
  const handlers = new Set<(input: unknown) => void>();
  let latest: string | undefined;

  const openEvents = (res: ServerResponse): void => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    // **ヘッダを先に送り出す。**書くものが無いうちは Node が溜めるので、
    // 画面側の `fetch` が返らず「繋がらない」ように見える（実際に検査で詰まった）。
    res.flushHeaders();
    res.write(': open\n\n');
    viewers.add(res);
    res.on('close', () => viewers.delete(res));
    // 途中から繋いだ画面にも、いまの状態を出す。空の枠を見せない。
    if (latest !== undefined) res.write(`data: ${latest}\n\n`);
  };

  const server: Server = createServer((req, res) => {
    if (req.url === videoPath) {
      writeVideo(res, options.source);
      return;
    }
    if (req.url === `${controlPath}/events`) {
      openEvents(res);
      return;
    }
    if (req.url === `${controlPath}/input`) {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      readInput(req, res, (input) => {
        for (const handler of handlers) handler(input);
      });
      return;
    }
    // 何があるかを漏らさない。存在するかどうかも答えない。
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(address.port)}${videoPath}`,
    controlUrl: `http://127.0.0.1:${String(address.port)}${controlPath}`,
    port: address.port,

    publish(state: unknown): void {
      latest = JSON.stringify(state);
      for (const viewer of viewers) {
        if (!viewer.writableEnded) viewer.write(`data: ${latest}\n\n`);
      }
    },

    onInput(handler: (input: unknown) => void): () => void {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },

    async close() {
      // 開いている線を先に閉じる。放っておくとプロセスが終われない。
      for (const viewer of viewers) viewer.end();
      viewers.clear();
      handlers.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
