import { spawn as spawnChild } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * **iPhone / iPad の口（WebDriverAgent）を、go-ios で立てて見張る**（2026-10-20・C103）。
 *
 * Windows では、人が go-ios の 3 本（tunnel・runwda・forward）を手で立て、
 * USB が繋がり直すたびに手で立て直していた。実機（Windows 11 ARM64・go-ios 1.3.2）で見た落ち方：
 *
 * - **tunnel は終わらずに居座り**、`data plane stopped` のあと約 3 秒で自分で `tunnel negotiated` に戻る
 * - **runwda は tunnel が落ちたのと同じ秒に終わる**
 * - **forward は居座るが、通さなくなる**（立て直すと通った）
 *
 * だから tunnel は 1 本立てて見張るだけにし、繋がるたびに runwda → 間を置いて forward 2 本、を立て直す。
 * **準備ができたかは `/status` の `ready` だけで見る**（runwda の `authorized: true` の後でも死んだ）。
 */

/** 立てた 1 本。出力は 1 行ずつ（go-ios は stderr に JSON 行で書く）。 */
export interface KeptProcess {
  onLine(callback: (line: string) => void): void;
  onExit(callback: () => void): void;
  kill(): void;
}

export interface WdaKeeperOptions {
  /** go-ios の実行ファイル（Windows なら ios.exe）。 */
  readonly iosPath: string;
  /** 端末の識別子。**tunnel にも付ける**（付けないと一覧の最初の端末に繋ぐ）。 */
  readonly udid: string;
  /** 端末に入れた WebDriverAgent の Bundle ID（`….xctrunner`）。 */
  readonly bundleId: string;
  readonly wdaPort?: number;
  readonly mjpegPort?: number;
  /** runwda から forward までの間（実機で 6 秒置いて通った。短くして試していない）。 */
  readonly pauseMs?: number;
  readonly pollMs?: number;
  /** これだけ待って ready にならなければ、立て直す。 */
  readonly readyLimitMs?: number;
  readonly spawn?: (command: string, args: readonly string[]) => KeptProcess;
  readonly isReady?: (url: string) => Promise<boolean>;
  readonly wait?: (ms: number) => Promise<void>;
  readonly log?: (line: string) => void;
}

export interface WdaKeeper {
  /** 手元から WebDriverAgent へ届く URL（forward の先）。 */
  readonly url: string;
  readonly isReady: boolean;
  /** 準備ができたら返る。`limitMs` を過ぎたら、理由を言って落ちる。 */
  ready(limitMs?: number): Promise<void>;
  close(): void;
}

const NEGOTIATED = /tunnel negotiated/;
const TUNNEL_LOST = /data plane stopped|tunnel connection failed/;
/** 開発用のディスクイメージが載っていない（go-ios 自身が `ios image auto` を勧める）。 */
const NO_IMAGE = /not available in RSD|ios image auto/;

export function startWdaKeeper(options: WdaKeeperOptions): WdaKeeper {
  const wdaPort = options.wdaPort ?? 8100;
  const mjpegPort = options.mjpegPort ?? 9100;
  const pauseMs = options.pauseMs ?? 6_000;
  const pollMs = options.pollMs ?? 2_000;
  const readyLimitMs = options.readyLimitMs ?? 90_000;
  const spawn = options.spawn ?? spawnKept;
  const isReady = options.isReady ?? wdaIsReady;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = options.log ?? ((line: string) => console.error(`[git-qa] ${line}`));
  const url = `http://127.0.0.1:${String(wdaPort)}`;
  const udid = `--udid=${options.udid}`;

  let closed = false;
  let tunnel: KeptProcess | undefined;
  let tunnelUp = false;
  let ready = false;
  /** 立て直すたびに上がる。**古い世代の知らせは無視する**（自分で止めた runwda の終了など）。 */
  let generation = 0;
  let chain: KeptProcess[] = [];
  let waiters: (() => void)[] = [];
  /** ディスクイメージを載せるのは 1 度だけ（直らないものを繰り返さない）。 */
  let imageTried = false;

  const stopChain = (): void => {
    generation += 1;
    ready = false;
    const old = chain;
    chain = [];
    for (const one of old) one.kill();
  };

  const retryLater = (): void => {
    void wait(pauseMs).then(() => {
      if (!closed && tunnelUp) void bringUp();
    });
  };

  const bringUp = async (): Promise<void> => {
    stopChain();
    const mine = generation;
    const runwda = spawn(options.iosPath, [
      'runwda',
      `--bundleid=${options.bundleId}`,
      `--testrunnerbundleid=${options.bundleId}`,
      '--xctestconfig=WebDriverAgentRunner.xctest',
      udid,
    ]);
    chain.push(runwda);
    let needsImage = false;
    /** **なぜ終わったかを人に渡す。**go-ios の最後の error をそのまま添える。 */
    let lastError = '';
    runwda.onLine((line) => {
      if (NO_IMAGE.test(line)) needsImage = true;
      const said = /"error":"((?:[^"\\]|\\.)*)"/.exec(line)?.[1];
      if (said !== undefined) lastError = said;
    });
    runwda.onExit(() => {
      if (mine !== generation || closed) return;
      stopChain();
      if (needsImage && !imageTried) {
        imageTried = true;
        log(
          '端末に開発用のディスクイメージが載っていない。go-ios で載せてから立て直す（初回は取ってくる）',
        );
        const image = spawn(options.iosPath, ['image', 'auto', udid]);
        image.onExit(() => {
          if (!closed && tunnelUp) void bringUp();
        });
        return;
      }
      log(
        needsImage
          ? 'WebDriverAgent が終わった（ディスクイメージを載せても直らない。Xcode で端末を一度つないでください）。立て直す'
          : `WebDriverAgent が終わった${lastError === '' ? '' : `（${lastError}）`}。立て直す`,
      );
      retryLater();
    });

    await wait(pauseMs);
    if (mine !== generation || closed) return;
    for (const port of [wdaPort, mjpegPort]) {
      chain.push(spawn(options.iosPath, ['forward', String(port), String(port), udid]));
    }

    const tries = Math.max(1, Math.ceil(readyLimitMs / pollMs));
    for (let i = 0; i < tries; i += 1) {
      const ok = await isReady(url).catch(() => false);
      if (mine !== generation || closed) return;
      if (ok) {
        ready = true;
        log(`WebDriverAgent の準備ができた（${url}）`);
        const done = waiters;
        waiters = [];
        for (const resolve of done) resolve();
        return;
      }
      await wait(pollMs);
    }
    log('WebDriverAgent の準備ができないまま時間が過ぎた。立て直す');
    stopChain();
    retryLater();
  };

  const startTunnel = (): void => {
    if (closed) return;
    tunnelUp = false;
    const mine = spawn(options.iosPath, ['tunnel', 'start', '--userspace', udid]);
    tunnel = mine;
    mine.onLine((line) => {
      if (mine !== tunnel || closed) return;
      if (NEGOTIATED.test(line) && !tunnelUp) {
        tunnelUp = true;
        log('端末と繋がった。WebDriverAgent を起こす');
        void bringUp();
      } else if (TUNNEL_LOST.test(line) && tunnelUp) {
        tunnelUp = false;
        log('端末との繋がりが切れた（USB が繋がり直した等）。張り直しを待つ');
        stopChain();
      }
    });
    mine.onExit(() => {
      if (mine !== tunnel || closed) return;
      log('tunnel が終わった。立て直す');
      tunnelUp = false;
      stopChain();
      void wait(pauseMs).then(startTunnel);
    });
  };

  startTunnel();

  return {
    url,
    get isReady() {
      return ready;
    },
    ready(limitMs) {
      if (ready) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        waiters.push(resolve);
        if (limitMs === undefined) return;
        setTimeout(() => {
          if (ready) return;
          reject(
            new Error(
              `WebDriverAgent の準備が ${String(Math.round(limitMs / 1000))} 秒でできなかった。` +
                '端末のロックを外し、ケーブルを確かめてください（docs/ios-press.md）',
            ),
          );
        }, limitMs).unref();
      });
    },
    close() {
      closed = true;
      stopChain();
      tunnel?.kill();
    },
  };
}

/**
 * 本物の子プロセス。**窓を出さない**（Windows でコンソールが 4 つ開くのを避ける）。
 *
 * **go-ios 専用の作業場所で動かす。**go-ios は今いる所に、端末と組むための名乗り（`selfIdentity.plist`）と、
 * `image auto` が取ってきたディスクイメージ（`devimages`・数十 MB）を書く。そのままだと
 * 利用者のプロジェクトに残り、名乗りが commit されかねない（2026-10-20・実機で踏んだ）。
 */
export function spawnKept(command: string, args: readonly string[]): KeptProcess {
  const cwd = join(tmpdir(), 'git-qa-go-ios');
  mkdirSync(cwd, { recursive: true });
  const child = spawnChild(command, [...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const lines: ((line: string) => void)[] = [];
  const exits: (() => void)[] = [];
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      for (const callback of lines) callback(line);
    });
  }
  let ended = false;
  const end = (): void => {
    if (ended) return;
    ended = true;
    for (const callback of exits) callback();
  };
  child.on('exit', end);
  // 立てられなかった（ios.exe が無い等）も終わりとして扱う。理由は見張る側が言う。
  child.on('error', (error) => {
    console.error(`[git-qa] ${command} を立てられない: ${error.message}`);
    end();
  });
  return {
    onLine: (callback) => lines.push(callback),
    onExit: (callback) => exits.push(callback),
    kill: () => {
      if (!ended) child.kill();
    },
  };
}

/** `/status` の `value.ready`。**これだけを準備の印にする**。 */
export async function wdaIsReady(url: string): Promise<boolean> {
  const res = await fetch(`${url}/status`, { signal: AbortSignal.timeout(3_000) });
  if (!res.ok) return false;
  const said = (await res.json()) as { value?: { ready?: unknown } };
  return said.value?.ready === true;
}

/**
 * **立てるかどうかを環境変数で決める**（`GIT_QA_IOS_GO` に go-ios の場所）。
 *
 * - 無ければ立てない（今までどおり、人が立てた口を `GIT_QA_IOS_WDA` で渡す）
 * - `GIT_QA_IOS_WDA` が在れば、人が立てた口を使う（奪わない）
 * - 端末（`GIT_QA_IOS_UDID`）と Bundle ID（`GIT_QA_IOS_WDA_BUNDLE`）が欠けていれば、何が要るかを言って止まる
 */
export function keeperSettings(
  env: Readonly<Record<string, string | undefined>>,
): Pick<WdaKeeperOptions, 'iosPath' | 'udid' | 'bundleId'> | undefined {
  const iosPath = env['GIT_QA_IOS_GO'];
  if (iosPath === undefined || iosPath === '') return undefined;
  if (env['GIT_QA_IOS_WDA'] !== undefined) return undefined;
  const udid = env['GIT_QA_IOS_UDID'];
  const bundleId = env['GIT_QA_IOS_WDA_BUNDLE'];
  const missing = [
    ...(udid === undefined || udid === ''
      ? ['GIT_QA_IOS_UDID（端末の識別子・ios list で出る）']
      : []),
    ...(bundleId === undefined || bundleId === ''
      ? ['GIT_QA_IOS_WDA_BUNDLE（端末に入れた WebDriverAgent の Bundle ID・….xctrunner）']
      : []),
  ];
  if (udid === undefined || udid === '' || bundleId === undefined || bundleId === '') {
    throw new Error(`go-ios で WebDriverAgent を立てるには、次も要ります: ${missing.join('、')}`);
  }
  return { iosPath, udid, bundleId };
}
