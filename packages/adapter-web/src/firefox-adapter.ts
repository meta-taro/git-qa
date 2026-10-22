import { execFile, spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AdapterError, encodeFrame } from '@git-qa/core';
import type {
  Action,
  AdapterCapabilities,
  LiveView,
  Observation,
  PointerRef,
  RecordingControl,
  Screenshot,
  TargetAdapter,
  TargetBuild,
  TargetSession,
} from '@git-qa/core';

import { createBidiClient, fromRemoteValue } from './bidi.js';
import type { BidiClient } from './bidi.js';
import { findElementScript, parseFoundPoint } from './find.js';
import {
  FIREFOX_CANDIDATES,
  dragActions,
  firefoxArgs,
  firefoxLaunch,
  firefoxPidPattern,
  parseBidiUrl,
  pointerActions,
  typeActions,
} from './firefox.js';
import { connectCdpSocket } from './socket.js';
import { forgetLaunched, rememberLaunched } from './stale.js';

/**
 * Firefox で見る（Issue 018 / C56）。
 *
 * **１％未満を切り捨てない。**Chrome / Edge に絞られたのは技術ではなく人手のコストで、
 * そのコストの形が変わるなら、切り捨てる理由も無くなる。
 *
 * **BiDi には screencast が無い。**絵は撮り続けて流す —— デスクトップアダプタと同じ形
 * （`image-frames`）。**道は既に作ってある。**
 */

const KIND = 'web';

/** 1 枚撮る間隔。**これより短く回しても、撮るほうが追いつかない。** */
const FRAME_INTERVAL_MS = 150;
/** 押した直後の画面は、まだ前の画面。 */
const DEFAULT_SETTLE_MS = 300;

const capabilities: AdapterCapabilities = {
  observation: 'dom',
  recording: false,
  // ブラウザは IME を通さずそのまま入る。**日本語も送れる。**
  textInput: 'any',
  /**
   * **まだ名乗らない**（外部レビュー #6・2026-09-13）。
   * `key` だけを送っており、`keyCode` が無いと既定の動作（送信・改行）が
   * 起きないことが多い。**「送った」と「効いた」は別。**確かめてから真にする。
   */
  keyInput: false,
  // **種類で絞れる**（#42）。要素の tag と role を見る。
  elementKinds: true,
  appId: 'package-or-url',
};

export interface FirefoxAdapterOptions {
  readonly build: TargetBuild;
  /**
   * 何処を見に行ったか（シートの `行き先`）。**「何を検証したか」（`build.source`）と分ける**
   * —— 外部レビュー meta-taro/git-qa#22。無ければ持たない。
   */
  readonly destination?: string;
  readonly url?: string;
  /** 使う Firefox。省略すると、入っているものを探す。 */
  readonly firefoxPath?: string;
  readonly size?: { readonly width: number; readonly height: number };
  readonly settleMs?: number;
  readonly loadTimeoutMs?: number;
  readonly startTimeoutMs?: number;
  readonly now?: () => Date;
}

async function findFirefox(explicit?: string): Promise<string> {
  for (const path of explicit === undefined ? FIREFOX_CANDIDATES : [explicit]) {
    try {
      await access(path);
      return path;
    } catch {
      // 次を探す。**1 つ無いだけで止めない。**
    }
  }
  throw new AdapterError(
    KIND,
    'Firefox が見つからない。入れるか、実行ファイルの場所を指定する' +
      `（探した場所: ${(explicit === undefined ? FIREFOX_CANDIDATES : [explicit]).join(' / ')}）`,
  );
}

/** `pgrep -f` で 1 つ探す。**見つからなくても止めない**（片付けは作業場所の名前で探し直す）。 */
function findPid(pattern: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('pgrep', ['-f', pattern], (_error, stdout) => {
      const pid = Number.parseInt(String(stdout).trim().split('\n')[0] ?? '', 10);
      resolve(Number.isInteger(pid) && pid > 0 ? pid : undefined);
    });
  });
}

export function createFirefoxAdapter(options: FirefoxAdapterOptions): TargetAdapter {
  const now = options.now ?? (() => new Date());

  return {
    kind: KIND,
    capabilities,

    async connect(): Promise<TargetSession> {
      const binary = await findFirefox(options.firefoxPath);
      // **人のプロファイルを触らない。**開いているタブ・履歴・ログインに手を出さない。
      const profileDir = await mkdtemp(join(tmpdir(), 'git-qa-ff-'));
      const stderrPath = join(profileDir, 'git-qa-stderr.log');
      const launch = firefoxLaunch({
        binary,
        args: firefoxArgs({
          port: 0,
          profileDir,
          ...(options.size === undefined ? {} : { size: options.size }),
        }),
        platform: process.platform,
        stderrPath,
      });
      const child = spawn(launch.command, [...launch.args], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      /**
       * LaunchServices から起こした Firefox 本体の番号。**`open` の子ではない**ので、
       * 止められたときに道連れにならない。見つけたら覚え、合図の中からも落とせるようにする
       * （`killLaunchedSync`・meta-taro/git-qa#20）。
       */
      let firefoxPid: number | undefined;

      const cleanup = async (): Promise<void> => {
        if (!launch.viaLaunchServices) {
          child.kill();
        } else if (firefoxPid !== undefined) {
          forgetLaunched(firefoxPid);
          try {
            process.kill(firefoxPid, 'SIGTERM');
          } catch {
            // もう居ない。**片付けは済んでいる。**
          }
        } else {
          // 番号を掴む前に落ちた。**この実行の作業場所の名前で探して止める。**
          await new Promise<void>((resolve) => {
            execFile('pkill', ['-f', firefoxPidPattern(profileDir)], () => resolve());
          });
        }
        await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
      };

      let bidi: BidiClient | undefined;
      try {
        const url = await new Promise<string>((resolve, reject) => {
          const limitMs = options.startTimeoutMs ?? 30_000;
          let seen = '';
          let poll: ReturnType<typeof setInterval> | undefined;
          const settle = (): void => {
            clearTimeout(timer);
            if (poll !== undefined) clearInterval(poll);
          };
          const timer = setTimeout(() => {
            settle();
            // **黙って待ち続けない。**何を待っていたのかを言う。
            reject(
              new AdapterError(
                KIND,
                `Firefox は起きたが、BiDi の繋ぎ先を言ってこない（${String(limitMs)} ms 待った）。` +
                  '**古い Firefox は BiDi を持っていない**（129 より前は CDP のみ）。' +
                  '新しい Firefox を入れる' +
                  (seen.trim() === '' ? '' : `。言ったこと: ${seen.trim().slice(-300)}`),
              ),
            );
          }, limitMs);
          const look = (text: string): void => {
            seen = text;
            const found = parseBidiUrl(seen);
            if (found === undefined) return;
            settle();
            resolve(found);
          };

          if (launch.viaLaunchServices) {
            // `open` は標準エラーをファイルへ書かせる。**出てくるまで読み直す。**
            poll = setInterval(() => {
              readFile(stderrPath, 'utf8').then(look, () => undefined);
            }, 200);
          } else {
            child.stderr?.on('data', (chunk: Buffer) => {
              look(seen + chunk.toString());
            });
          }
          child.on('exit', (code) => {
            // `open` は Firefox を頼んだらすぐ終わる。**終わったこと自体は失敗ではない。**
            if (launch.viaLaunchServices && code === 0) return;
            settle();
            reject(new AdapterError(KIND, `Firefox が起動せずに終わった（${String(code)}）`));
          });
        });

        if (launch.viaLaunchServices) {
          firefoxPid = await findPid(firefoxPidPattern(profileDir));
          rememberLaunched(firefoxPid);
        }

        bidi = createBidiClient(await connectCdpSocket(`${url}/session`));

        // BiDi は「見る場所（context）」を先に決める。
        await bidi.send('session.new', { capabilities: { alwaysMatch: {} } });
        const tree = await bidi.send('browsingContext.getTree', {});
        const contexts = tree['contexts'];
        const context = Array.isArray(contexts)
          ? ((contexts[0] as { context?: unknown } | undefined)?.context ?? undefined)
          : undefined;
        if (typeof context !== 'string') {
          throw new AdapterError(KIND, 'Firefox に見る画面が 1 枚も無い');
        }

        const start = options.url ?? options.build.source;
        // **行き先はシートが宣言したものだけ**（C40）。
        await bidi.send('browsingContext.navigate', { context, url: start, wait: 'complete' });

        // **版を証跡に残す**（C56）。同じ画面でも版が違えば結果が変わる。
        const agent = await bidi
          .send('script.evaluate', {
            expression: 'navigator.userAgent',
            target: { context },
            awaitPromise: false,
          })
          .catch(() => undefined);
        const ua = fromRemoteValue(agent?.['result']);
        const version =
          typeof ua === 'string' ? (/Firefox\/[\d.]+/.exec(ua)?.[0] ?? undefined) : undefined;
        const label = version === undefined ? 'Mozilla Firefox' : `Mozilla Firefox（${version}）`;

        return createSession({ bidi, context, cleanup, options, now, binary, label });
      } catch (error) {
        // 掴んだまま投げない。**起こした Firefox と作業場所を残さない。**
        await bidi?.close().catch(() => undefined);
        await cleanup();
        throw error;
      }
    },
  };
}

interface SessionDeps {
  readonly bidi: BidiClient;
  readonly context: string;
  readonly cleanup: () => Promise<void>;
  readonly options: FirefoxAdapterOptions;
  readonly now: () => Date;
  readonly binary: string;
  /** 証跡に残す「何で見たか」。例: `Mozilla Firefox（Firefox/141.0）`。 */
  readonly label: string;
}

function createSession(deps: SessionDeps): TargetSession {
  const { bidi, context, now } = deps;
  let closed = false;
  let liveOpen = false;

  const ensureOpen = (): void => {
    if (closed) throw new AdapterError(KIND, 'Firefox との接続はもう閉じている');
  };

  /** 1 枚撮る。**BiDi に screencast は無い**ので、撮り続けて流す。 */
  const shoot = async (): Promise<Uint8Array | undefined> => {
    const result = await bidi
      .send('browsingContext.captureScreenshot', { context })
      .catch(() => undefined);
    const data = result?.['data'];
    if (typeof data !== 'string' || data === '') return undefined;
    return new Uint8Array(Buffer.from(data, 'base64'));
  };

  const evaluate = async (expression: string): Promise<unknown> => {
    const result = await bidi.send('script.evaluate', {
      expression,
      target: { context },
      awaitPromise: false,
      resultOwnership: 'none',
    });
    // **BiDi は型つきで返す。**素の値へ戻さないと、画面の文字が空になる。
    return fromRemoteValue(result['result']);
  };

  const liveView: LiveView = {
    get isOpen() {
      return liveOpen;
    },
    transport: { kind: 'image-frames', label: 'firefox bidi', mimeType: 'image/jpeg' },
    open() {
      ensureOpen();
      liveOpen = true;
      return Promise.resolve();
    },
    close() {
      liveOpen = false;
      return Promise.resolve();
    },
    frames(): AsyncIterable<Uint8Array> {
      if (!liveOpen) {
        throw new AdapterError(KIND, '映像を出す準備ができていない（ライブビューを開く前）');
      }
      return {
        async *[Symbol.asyncIterator]() {
          while (liveOpen && !closed) {
            const started = Date.now();
            // 撮れない 1 枚で映像を終わらせない。
            const bytes = await shoot();
            if (bytes !== undefined) yield encodeFrame(bytes);

            const rest = FRAME_INTERVAL_MS - (Date.now() - started);
            if (rest > 0) await new Promise((resolve) => setTimeout(resolve, rest));
          }
        },
      };
    },
  };

  const recording: RecordingControl = {
    requested: false,
    start: () => Promise.resolve(),
    stop: () =>
      Promise.resolve({ state: 'unsupported' as const, reason: 'ウェブの録画はまだ持っていない' }),
  };

  const resolvePoint = async (ref: PointerRef): Promise<{ x: number; y: number }> => {
    if (ref.at === 'point') return { x: ref.x, y: ref.y };
    const point = parseFoundPoint(await evaluate(findElementScript(ref.ref, ref.kind)));
    if (point === undefined) {
      throw new AdapterError(KIND, `画面に見つからない要素: ${JSON.stringify(ref.ref)}`);
    }
    return point;
  };

  const perform = (actions: readonly unknown[]): Promise<unknown> =>
    bidi.send('input.performActions', { context, actions });

  return {
    // **何で見たかは証跡に残る。**版は Firefox 自身に聞いたものを入れる（C56）。
    target: {
      kind: KIND,
      browser: deps.label,
      build: deps.options.build,
      ...(deps.options.destination === undefined ? {} : { destination: deps.options.destination }),
    },
    liveView,
    recording,
    get isClosed() {
      return closed;
    },

    async act(action: Action): Promise<void> {
      ensureOpen();

      if (action.kind === 'launch') {
        await bidi.send('browsingContext.navigate', {
          context,
          url: action.app,
          wait: 'complete',
        });
      } else if (action.kind === 'tap') {
        await perform(pointerActions(await resolvePoint(action.target)));
      } else if (action.kind === 'drag') {
        await perform(dragActions(await resolvePoint(action.from), await resolvePoint(action.to)));
      } else if (action.kind === 'type') {
        if (action.target !== undefined) {
          await perform(pointerActions(await resolvePoint(action.target)));
        }
        await perform(typeActions(action.text));
      } else if (action.kind === 'key') {
        await perform(typeActions(action.key));
      } else if (action.kind === 'doubleTap') {
        // **黙って 1 回押しに化けさせない**（#42）。
        throw new AdapterError(
          KIND,
          'ダブルクリックはまだ送れない（この相手は名乗っていないので、ふつうはここへ来ない）',
        );
      } else {
        // swipe。ブラウザではスクロールとして送る。
        const from = await resolvePoint(action.from);
        const to = await resolvePoint(action.to);
        await evaluate(`window.scrollBy(${String(from.x - to.x)}, ${String(from.y - to.y)})`);
      }

      // **押した直後の画面は、まだ前の画面。**
      await new Promise((resolve) =>
        setTimeout(resolve, deps.options.settleMs ?? DEFAULT_SETTLE_MS),
      );
    },

    async observe(): Promise<Observation> {
      ensureOpen();
      const value = await evaluate(
        '({ html: document.documentElement.outerHTML, text: document.body ? document.body.innerText : "" })',
      );
      const observed = value as { html?: unknown; text?: unknown } | undefined;
      return {
        kind: KIND,
        capturedAt: now().toISOString(),
        raw: {
          html: typeof observed?.html === 'string' ? observed.html : '',
          text: typeof observed?.text === 'string' ? observed.text : '',
        },
      };
    },

    async screenshot(): Promise<Screenshot> {
      ensureOpen();
      const bytes = await shoot();
      if (bytes === undefined) {
        throw new AdapterError(KIND, 'Firefox の画面を撮れなかった（空が返った）');
      }
      return { format: 'png', bytes, capturedAt: now().toISOString() };
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      liveOpen = false;
      await bidi.close().catch(() => undefined);
      await deps.cleanup();
    },
  };
}
