import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { isValidHandle } from '@git-qa/core';
import { corsHeaders } from '@git-qa/live-bridge';

/**
 * アプリを入口にするための口（Issue 011 段階 3）。
 *
 * **いまの入口はターミナルだった。**「検証シートの読み込み方も Android の接続の仕方も
 * 分からない」という指摘に対して、**アプリを開いたら選んで始められる**ようにする。
 *
 * ここは**端末に繋ぐ前から待っている**必要がある（選ぶ前に画面が要るので）。
 * 守りは橋と同じ — **127.0.0.1 だけ・URL に無作為の 32 文字・画面のオリジンにだけ許しを返す。**
 *
 * **状態は画面から取りに来てもらう（polling）。**選ぶ画面は遅れに厳しくないので、
 * SSE の仕掛けを増やすより、取りに来るほうが部品が少なくて済む。
 */

export interface SetupDevice {
  readonly serial: string;
  readonly state: string;
}

export type SetupPhase = 'idle' | 'starting' | 'running' | 'failed';

export interface SetupState {
  readonly phase: SetupPhase;
  readonly devices: readonly SetupDevice[];
  /** 見つかった検証シート。人はここから選ぶ。 */
  readonly sheets: readonly string[];
  readonly liveUrl?: string;
  readonly controlUrl?: string;
  /** 始められなかった理由。**黙って idle へ戻さない。** */
  readonly error?: string;
}

export interface StartedRun {
  readonly liveUrl: string;
  readonly controlUrl: string;
}

export interface StartSetupServerOptions {
  readonly listDevices: () => Promise<readonly SetupDevice[]>;
  readonly findSheets: () => Promise<readonly string[]>;
  readonly start: (params: {
    serial: string;
    sheetPath: string;
    /** 置いた人。**個人名ではなくハンドル**（公開リポジトリ・§25）。 */
    operator?: string;
  }) => Promise<StartedRun>;
  readonly port?: number;
}

export interface SetupServer {
  /** 画面が読む URL（無作為の文字列を含む）。`?setup=` に渡す。 */
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

/** 選ぶ画面から来る本文はごく小さい。これより大きいものは、この口へ来るものではない。 */
const MAX_BODY_BYTES = 16 * 1024;

function readJson(
  req: IncomingMessage,
  res: ServerResponse,
  cors: Record<string, string>,
  accept: (body: unknown) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;

  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      if (!res.writableEnded) res.writeHead(413, cors).end();
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
      // 握り潰さない。読めない指示を「無かったこと」にすると、人は押したつもりで待つ。
      res.writeHead(400, cors).end();
    }
  });
}

export async function startSetupServer(options: StartSetupServerOptions): Promise<SetupServer> {
  const token = randomBytes(16).toString('hex');
  const base = `/setup/${token}`;

  let phase: SetupPhase = 'idle';
  let started: StartedRun | undefined;
  let failure: string | undefined;

  /**
   * 見つけたシート。**毎回は探し直さない。**
   * 状態は毎秒取りに来るので、そのたびにディスクを掘ると重い（配布物では home の下を見る）。
   */
  let sheets: readonly string[] | undefined;

  const state = async (): Promise<SetupState> => ({
    phase,
    // **選ぶたびに取り直す。**繋ぎ替えた端末が出てこないと、人は待たされ続ける。
    devices: phase === 'idle' ? await options.listDevices() : [],
    sheets: phase === 'idle' ? (sheets ??= await options.findSheets()) : [],
    ...(started === undefined ? {} : started),
    ...(failure === undefined ? {} : { error: failure }),
  });

  const begin = (serial: string, sheetPath: string, operator: string | undefined): void => {
    phase = 'starting';
    failure = undefined;
    void options
      .start({ serial, sheetPath, ...(operator === undefined ? {} : { operator }) })
      .then((run) => {
        started = run;
        phase = 'running';
      })
      .catch((error: unknown) => {
        // 黙って idle へ戻さない。**なぜ始まらなかったのかが人に見えなくなる。**
        failure = error instanceof Error ? error.message : String(error);
        phase = 'failed';
      });
  };

  const server: Server = createServer((req, res) => {
    const cors = corsHeaders(req.headers.origin);

    if (req.url === `${base}/state`) {
      void state().then((current) => {
        res
          .writeHead(200, {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            ...cors,
          })
          .end(JSON.stringify(current));
      });
      return;
    }

    if (req.url === `${base}/start`) {
      if (req.method === 'OPTIONS') {
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
      // 走っている最中に始め直さない。**端末を二重に掴む。**
      if (phase !== 'idle' && phase !== 'failed') {
        res.writeHead(409, cors).end();
        return;
      }

      readJson(req, res, cors, (body) => {
        const serial = (body as { serial?: unknown }).serial;
        const sheetPath = (body as { sheetPath?: unknown }).sheetPath;
        const operator = (body as { operator?: unknown }).operator;
        if (typeof serial !== 'string' || typeof sheetPath !== 'string') {
          res.writeHead(400, cors).end();
          return;
        }
        // ハンドルは短い。**個人名やメールを書かせない**（公開リポジトリ・§25）。
        if (operator !== undefined && (typeof operator !== 'string' || operator.length > 64)) {
          res.writeHead(400, cors).end();
          return;
        }
        // **始める前に確かめる。**証跡の schema は ASCII に限っている（C18）。
        // ここで通すと、5 件置き終わったあとの保存で落ちる — 実際に人の作業が 2 回消えた。
        if (operator !== undefined && operator !== '' && !isValidHandle(operator)) {
          res
            .writeHead(400, { ...cors, 'content-type': 'text/plain; charset=utf-8' })
            .end('担当者ハンドルは英数字とハイフンだけ（先頭は英数字・39 文字まで）');
          return;
        }
        begin(serial, sheetPath, operator);
        res.writeHead(202, cors).end();
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
    url: `http://127.0.0.1:${String(address.port)}${base}`,
    port: address.port,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
