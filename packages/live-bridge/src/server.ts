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
 *
 * **なぜ CORS の許しを返すか**: 画面（`localhost:1420` / `tauri://localhost`）と橋
 * （`127.0.0.1:<port>`）は**別オリジン**で、許しが無いとブラウザが読み取りを弾く。
 * **実機でここが落ちた**（画面に「Load failed」と出た）。`curl` と Node の `fetch` は
 * CORS を課さないので、検査を全部通ったまま壊れていた。
 * **許すのは画面のオリジンだけ。**`*` にすると、同じ PC で開いている任意の web ページから
 * 読める口になる（token を知られた場合に、検証中の端末の画面が漏れる）。
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

/**
 * 読み取りを許す画面のオリジン。
 *
 * - `http://localhost:1420` / `http://127.0.0.1:1420` — 開発中（vite）
 * - `tauri://localhost` — macOS / Linux の配布物
 * - `https://tauri.localhost` — Windows の配布物
 *
 * **開発だけ通る形にしない。**配布物で落ちるのは、いちばん気づくのが遅れる壊れ方。
 */
const ALLOWED_ORIGINS: readonly string[] = [
  'http://localhost:1420',
  'http://127.0.0.1:1420',
  'tauri://localhost',
  'https://tauri.localhost',
];

/**
 * 名乗ってきたオリジンが許せるものなら、そのまま返す。**`*` は返さない。**
 *
 * **輸出しているのは、同じ規則を 2 箇所に書かないため。**片方だけ緩めると気づけない。
 */
export function corsHeaders(origin: string | undefined): Record<string, string> {
  if (origin === undefined || !ALLOWED_ORIGINS.includes(origin)) return {};
  return { 'access-control-allow-origin': origin, vary: 'origin' };
}

function writeVideo(
  res: ServerResponse,
  source: () => AsyncIterable<Uint8Array>,
  cors: Record<string, string>,
): void {
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
    // 途中で溜め込ませない。溜まると、測っているのが自分の遅延でなくなる。
    'x-accel-buffering': 'no',
    ...cors,
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
  cors: Record<string, string>,
  accept: (input: unknown) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;

  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) {
      if (!res.writableEnded) {
        res.writeHead(413, cors).end();
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
      res.writeHead(400, cors).end();
      return;
    }
    res.writeHead(202, cors).end();
  });
}

export async function startLiveBridge(options: LiveBridgeOptions): Promise<LiveBridge> {
  const token = randomBytes(16).toString('hex');
  const videoPath = `/live/${token}.h264`;
  const controlPath = `/live/${token}/control`;

  const viewers = new Set<ServerResponse>();
  /** 画面が置いた様子（診断）。**人に聞かないと分からない状態を減らすため。** */
  let diagnostics: string | undefined;
  const handlers = new Set<(input: unknown) => void>();
  let latest: string | undefined;

  const openEvents = (res: ServerResponse, cors: Record<string, string>): void => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      ...cors,
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
    const cors = corsHeaders(req.headers.origin);

    if (req.url === videoPath) {
      writeVideo(res, options.source, cors);
      return;
    }
    if (req.url === `${controlPath}/events`) {
      openEvents(res, cors);
      return;
    }
    if (req.url === `${controlPath}/diag`) {
      if (req.method === 'OPTIONS') {
        // 診断も content-type を付けて送るので、ブラウザが先に許しを聞きに来る。
        // **ここに応えないと、画面からの POST がまるごと弾かれる**（実際に届かなかった）。
        res
          .writeHead(204, {
            ...cors,
            'access-control-allow-methods': 'POST, GET, OPTIONS',
            'access-control-allow-headers': 'content-type',
            'access-control-max-age': '600',
          })
          .end();
        return;
      }
      if (req.method === 'POST') {
        readInput(req, res, cors, (value) => {
          diagnostics = JSON.stringify(value);
        });
        return;
      }
      res
        .writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          ...cors,
        })
        .end(diagnostics ?? JSON.stringify({ reported: false }));
      return;
    }
    if (req.url === `${controlPath}/input`) {
      if (req.method === 'OPTIONS') {
        // 打鍵は content-type を付けて送るので、ブラウザが先に許しを聞きに来る。
        res
          .writeHead(204, {
            ...cors,
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'content-type',
            'access-control-max-age': '600',
          })
          .end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, cors).end();
        return;
      }
      readInput(req, res, cors, (input) => {
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
