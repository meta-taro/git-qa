import { runnerOf } from './release.js';
import { newerRelease } from './update.js';
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

/**
 * `'done'` は**走り終えた**（外部レビュー meta-taro/git-qa#5）。
 *
 * それまで `idle → starting → running` と進んだきり、**戻る道も先へ進む道も無かった。**
 * 「走っている最中」と「走り終えた」が同じ値だったので、
 * **1 本走らせると、その入口は二度と使えなかった。**
 */
export type SetupPhase = 'idle' | 'starting' | 'running' | 'done' | 'failed';

/**
 * 途中で止まった実行（2026-09-12・人の指示）。
 *
 * **どこまで人が見て置いたか**を添える。選ぶときに、いちばん知りたいのがそこ。
 */
export interface SetupResumable {
  readonly runId: string;
  readonly sheetPath: string;
  readonly startedAt: string;
  readonly cases: number;
  readonly placed: number;
}

export interface SetupState {
  readonly phase: SetupPhase;
  readonly devices: readonly SetupDevice[];
  /** 見つかった検証シート。人はここから選ぶ。 */
  readonly sheets: readonly string[];
  /** 途中で止まった実行。**続きから走らせられる。** */
  readonly resumable?: readonly SetupResumable[];
  /**
   * 端末の一覧を取れなかった理由（2026-09-12）。
   *
   * **端末が見えないことと、画面が出ないことは別。**`adb` が入っていない機械は普通にある
   * （ウェブだけ見る人・Windows）。**理由を出して、他の道は残す。**
   */
  readonly deviceError?: string;
  readonly liveUrl?: string;
  readonly controlUrl?: string;
  /** 流れてくる映像の種類。**画面側では決められない**ので、実行器が知らせる（C54）。 */
  readonly liveKind?: 'h264' | 'images';
  /** 始められなかった理由。**黙って idle へ戻さない。** */
  readonly error?: string;
  /**
   * **新しい版が出ている**（2026-09-18）。
   *
   * 2 日で 10 本出した。**受け取る側は、出たことを知る手段を持っていなかった。**
   * **勝手に入れ替えない。**出ていることを言うだけで、入れるかは人が決める。
   */
  readonly update?: { readonly version: string; readonly url: string };
}

export interface StartedRun {
  readonly liveUrl: string;
  readonly controlUrl: string;
  /**
   * 実行が終わったら解決する約束（外部レビュー meta-taro/git-qa#5）。
   *
   * `start` が解決するのは**始まった**時点なので、これが無いと
   * **終わったことを入口が知れない。****渡さなければ今までどおり**（`running` のまま）。
   *
   * **画面へは出さない**（約束は JSON にできない。`{}` になって人を惑わせる）。
   */
  readonly done?: Promise<unknown>;
  /**
   * 流れてくる映像の種類。**画面側では決められない。**
   * Android は H.264、ウェブはブラウザの画像 1 枚ずつ（C54）。
   */
  readonly liveKind?: 'h264' | 'images';
}

/** 画面から来た「これで始めてくれ」。 */
export interface StartRequest {
  /**
   * 見る相手。**端末の serial か、ウェブページの URL。**
   * どちらかは呼ばれた側（`app-cli`）が形で見分ける。
   */
  readonly serial: string;
  readonly sheetPath: string;
  /** 置いた人。**個人名ではなくハンドル**（公開リポジトリ・§25）。 */
  readonly operator?: string;
  /** どのブラウザで見るか（ウェブのときだけ）。**証跡に版が残る。** */
  readonly browser?:
    'chrome' | 'edge' | 'brave' | 'opera' | 'vivaldi' | 'chromium' | 'firefox' | 'safari';
  /** 名前の無いブラウザの場所。**中身が Chromium なら動く。** */
  readonly browserPath?: string;
  /**
   * **鑑賞モードで始める**（2026-09-11・人の指示）。
   *
   * > 人はぼーっとみながら AI のテストを鑑賞します。
   *
   * 押さなくても 1 件ごとに間をおいて進む。**真のときだけ持つ。**
   */
  readonly watch?: true;
  /**
   * **続きから**（2026-09-12・人の指示）。止まった実行の ID。
   *
   * 渡すと、**その実行に足す。**新しい実行にすると証跡が 2 本に割れる。
   */
  readonly resume?: string;
}

export interface StartSetupServerOptions {
  readonly listDevices: () => Promise<readonly SetupDevice[]>;
  readonly findSheets: () => Promise<readonly string[]>;
  /** 途中で止まった実行を探す。**渡さなければ「続きから」を出さない。** */
  readonly findResumable?: () => Promise<readonly SetupResumable[]>;
  readonly start: (params: StartRequest) => Promise<StartedRun>;
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
  let resumable: readonly SetupResumable[] | undefined;

  /**
   * **新しい版は 1 度だけ聞く。**状態は毎秒取りに来るので、
   * そのたびに外へ出ると **GitHub に断られる**（それ以前に、外へ出る回数を増やさない）。
   */
  const update = await newerRelease(runnerOf().version);

  /**
   * **1 つ数え損ねたくらいで、画面ごと出さないのはやりすぎ**（2026-09-12）。
   *
   * `adb` が入っていない機械では `listAndroidDevices` が `ENOENT` を投げる。
   * それを `.catch` していなかったので、**`/state` が応答を返さないまま固まっていた** ——
   * 画面は「読み込み中」のまま、理由も出ない。
   * **Android を見ないならウェブの URL だけで始められるのに、入口で止まる。**
   */
  const orEmpty = async <T>(
    work: () => Promise<readonly T[]>,
    onError?: (reason: string) => void,
  ): Promise<readonly T[]> => {
    try {
      return await work();
    } catch (error: unknown) {
      onError?.(error instanceof Error ? error.message : String(error));
      return [];
    }
  };

  const state = async (): Promise<SetupState> => {
    if (phase !== 'idle' && phase !== 'done') {
      return {
        phase,
        devices: [],
        sheets: [],
        ...(started === undefined ? {} : started),
        ...(failure === undefined ? {} : { error: failure }),
      };
    }

    let deviceError: string | undefined;
    // **選ぶたびに取り直す。**繋ぎ替えた端末が出てこないと、人は待たされ続ける。
    const devices = await orEmpty(
      () => options.listDevices(),
      (reason) => (deviceError = reason),
    );
    // シートと止まった実行は**毎回は探し直さない。**失敗しても画面は出す。
    sheets ??= await orEmpty(() => options.findSheets());
    if (options.findResumable !== undefined) {
      resumable ??= await orEmpty(() => options.findResumable?.() ?? Promise.resolve([]));
    }

    return {
      phase,
      devices,
      sheets,
      ...(resumable === undefined ? {} : { resumable }),
      ...(deviceError === undefined ? {} : { deviceError }),
      ...(update === undefined ? {} : { update }),
      ...(started === undefined ? {} : started),
      ...(failure === undefined ? {} : { error: failure }),
    };
  };

  const begin = (request: StartRequest): void => {
    phase = 'starting';
    failure = undefined;
    void options
      .start(request)
      .then(({ done, ...run }) => {
        started = run;
        phase = 'running';
        // **終わったら、次を受け取れるようにする。**
        // 渡されなければ `running` のまま（古い呼び側を壊さない）。
        void done?.finally(() => {
          // 既に次が始まっていれば、そちらを上書きしない。
          if (phase === 'running') phase = 'done';
        });
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
      void state()
        .then((current) => {
          res
            .writeHead(200, {
              'content-type': 'application/json',
              'cache-control': 'no-store',
              ...cors,
            })
            .end(JSON.stringify(current));
        })
        // **何があっても応答は返す。**返さないと、画面は「読み込み中」のまま止まる。
        .catch((error: unknown) => {
          res
            .writeHead(500, { 'content-type': 'text/plain; charset=utf-8', ...cors })
            .end(error instanceof Error ? error.message : String(error));
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
      // **走っている最中は断る。**端末を二重に掴む。
      // 走り終えた（`done`）なら受け取る —— そこが `running` と同じ値だったのが #5。
      if (phase !== 'idle' && phase !== 'failed' && phase !== 'done') {
        // **断るなら理由を出す。**本文が無いと、画面に出せるものが無い。
        res
          .writeHead(409, { ...cors, 'content-type': 'text/plain; charset=utf-8' })
          .end(
            phase === 'starting'
              ? 'いま始めているところ。少し待ってからもう一度'
              : 'いま検証が走っている。終わるか、画面を閉じてからもう一度',
          );
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
        // **始める前に確かめる。**規則の正本は証跡の schema（C18 / C53）。
        // ここで通すと、5 件置き終わったあとの保存で落ちる — 実際に人の作業が 2 回消えた。
        if (operator !== undefined && operator !== '' && !isValidHandle(operator)) {
          res
            .writeHead(400, { ...cors, 'content-type': 'text/plain; charset=utf-8' })
            .end('ハンドルに空白か区切り（/ \\）が入っているか、39 文字を超えている（0 の欄）');
          return;
        }
        const wanted = (body as { browser?: unknown }).browser;
        // **知らない値は捨てる。**勝手に別のブラウザで見ない。
        const browser = (
          ['chrome', 'edge', 'brave', 'opera', 'vivaldi', 'chromium', 'firefox', 'safari'] as const
        ).find((name) => name === wanted);
        const wantedPath = (body as { browserPath?: unknown }).browserPath;
        // **知らない形は捨てる。**長すぎるものも通さない（§21）。
        const browserPath =
          typeof wantedPath === 'string' && wantedPath !== '' && wantedPath.length <= 500
            ? wantedPath
            : undefined;
        /**
         * **鑑賞モードで始めるかどうか**（2026-09-11・人の指示）。
         *
         * > 人はぼーっとみながら AI のテストを鑑賞します。
         *
         * **真のときだけ渡す。**`false` を運ぶと「鑑賞ではないと指定された」と
         * 「何も言われていない」が同じ形になる。
         */
        const watch = (body as { watch?: unknown }).watch === true;

        /**
         * **続きから**（2026-09-12）。止まった実行の ID。
         *
         * **形のおかしいものは捨てる。**この値はフォルダ名として使うので、
         * `../` が混ざると別の場所を読みに行く（§21 —— 入力を信用しない）。
         */
        const wantedResume = (body as { resume?: unknown }).resume;
        const resume =
          typeof wantedResume === 'string' && /^[0-9]{8}-[0-9]{6}$/.test(wantedResume)
            ? wantedResume
            : undefined;

        begin({
          serial,
          sheetPath,
          ...(operator === undefined ? {} : { operator }),
          ...(browser === undefined ? {} : { browser }),
          ...(browserPath === undefined ? {} : { browserPath }),
          ...(watch ? { watch: true } : {}),
          ...(resume === undefined ? {} : { resume }),
        });
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
