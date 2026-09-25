import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

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

import { findElementScript, parseFoundPoint, parseViewport, viewportScript } from './find.js';
import { createWebDriverClient, w3cDrag, w3cPointer, w3cType } from './webdriver.js';
import type { WebDriverClient } from './webdriver.js';

/**
 * Safari で見る（Issue 018 / C56）。
 *
 * **3 本目の約束。**Chrome は CDP、Firefox は BiDi、Safari は WebDriver（HTTP）。
 * `safaridriver` は OS 付属なので、**依存はまた足さない。**
 *
 * **人が 1 回だけ設定する所がある**（§14 と同じ扱い）。実測で返ってきた文:
 * `You must enable 'Allow remote automation' in the Developer section of Safari Settings`
 *
 * **WebDriver に screencast は無い。**絵は撮り続けて流す（`image-frames`）
 * —— デスクトップ・Firefox と同じ道。
 */

const KIND = 'web';
const FRAME_INTERVAL_MS = 200;
const DEFAULT_SETTLE_MS = 300;

const capabilities: AdapterCapabilities = {
  observation: 'dom',
  recording: false,
  textInput: 'any',
  /**
   * **まだ名乗らない**（外部レビュー #6・2026-09-13）。
   * `key` だけを送っており、`keyCode` が無いと既定の動作（送信・改行）が
   * 起きないことが多い。**「送った」と「効いた」は別。**確かめてから真にする。
   */
  keyInput: false,
  appId: 'package-or-url',
};

export interface SafariAdapterOptions {
  readonly build: TargetBuild;
  /**
   * 何処を見に行ったか（シートの `行き先`）。**「何を検証したか」（`build.source`）と分ける**
   * —— 外部レビュー meta-taro/git-qa#22。無ければ持たない。
   */
  readonly destination?: string;
  readonly url?: string;
  readonly settleMs?: number;
  readonly startTimeoutMs?: number;
  readonly now?: () => Date;
  /**
   * 触る場所・見る場所が決まったら知らせる（要望シート No.1）。
   * **人が「ここ」と見られるように。**Chrome と同じ形で渡す。
   */
  readonly onPointed?: (at: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    label?: string;
  }) => void;
}

/** 空いている番号を OS に選ばせる。**決め打ちにすると、2 本目が起きない。** */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export function createSafariAdapter(options: SafariAdapterOptions): TargetAdapter {
  const now = options.now ?? (() => new Date());

  return {
    kind: KIND,
    capabilities,

    async connect(): Promise<TargetSession> {
      const port = await freePort();
      const driver = spawn('safaridriver', ['-p', String(port)], { stdio: 'ignore' });
      const base = `http://127.0.0.1:${String(port)}`;
      const client = createWebDriverClient(base);

      const cleanup = async (): Promise<void> => {
        await client.close().catch(() => undefined);
        driver.kill();
      };

      try {
        await waitReady(base, options.startTimeoutMs ?? 15_000);
        await client.open();

        const start = options.url ?? options.build.source;
        // **行き先はシートが宣言したものだけ**（C40）。
        await client.post('/url', { url: start });

        const agent = await client.post('/execute/sync', {
          script: 'return navigator.userAgent',
          args: [],
        });
        const version =
          typeof agent === 'string' ? (/Version\/[\d.]+/.exec(agent)?.[0] ?? undefined) : undefined;
        const label = version === undefined ? 'Safari' : `Safari（${version}）`;

        return createSafariSession({ client, cleanup, options, now, label });
      } catch (error) {
        await cleanup();
        // **人が何をすればよいかを、そのまま渡す。**言い換えると原因が絞れなくなる。
        const detail = error instanceof Error ? error.message : String(error);
        throw new AdapterError(
          KIND,
          detail.includes('Allow remote automation')
            ? 'Safari を外から動かす許可が入っていない。' +
                'Safari の設定 →「デベロッパ」タブ →「リモートオートメーションを許可」に' +
                'チェックを入れる。' +
                '（「デベロッパ」タブが無ければ、先に「詳細」タブの' +
                '「Web デベロッパ用の機能を表示」を入れる。' +
                '古い版では「開発」メニューの中にある）' +
                `元の理由: ${detail}`
            : detail,
        );
      }
    },
  };
}

/** `safaridriver` が待ち受けるまで待つ。**永久には待たない。** */
async function waitReady(base: string, limitMs: number): Promise<void> {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    const ok = await fetch(`${base}/status`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`safaridriver が待ち受けない（${String(limitMs)} ms 待った）`);
}

interface SessionDeps {
  readonly client: WebDriverClient;
  readonly cleanup: () => Promise<void>;
  readonly options: SafariAdapterOptions;
  readonly now: () => Date;
  readonly label: string;
}

/**
 * **口を差し替えて検査できる形にする**（product-baseline §4）。
 *
 * `createSafariAdapter` は `safaridriver` を起こすので、そのままでは
 * **ブラウザの在る機械でしか確かめられない。**繋ぐ先（`WebDriverClient`）を
 * 外から渡せるようにして、**起こさずに確かめる。**
 */
export function createSafariSession(deps: SessionDeps): TargetSession {
  const { client, now } = deps;
  let closed = false;
  let liveOpen = false;

  const ensureOpen = (): void => {
    if (closed) throw new AdapterError(KIND, 'Safari との接続はもう閉じている');
  };

  const shoot = async (): Promise<Uint8Array | undefined> => {
    const data = await client.get('/screenshot').catch(() => undefined);
    if (typeof data !== 'string' || data === '') return undefined;
    return new Uint8Array(Buffer.from(data, 'base64'));
  };

  const evaluate = (expression: string): Promise<unknown> =>
    client.post('/execute/sync', { script: `return (${expression})`, args: [] });

  const resolvePoint = async (ref: PointerRef): Promise<{ x: number; y: number }> => {
    if (ref.at === 'point') return { x: ref.x, y: ref.y };
    const point = parseFoundPoint(await evaluate(findElementScript(ref.ref)));
    if (point === undefined) {
      throw new AdapterError(KIND, `画面に見つからない要素: ${JSON.stringify(ref.ref)}`);
    }
    // **見つけた所を知らせる**（要望シート No.1）。枠で囲むために大きさも渡す。
    deps.options.onPointed?.({
      x: point.x,
      y: point.y,
      ...(point.width === undefined ? {} : { width: point.width }),
      ...(point.height === undefined ? {} : { height: point.height }),
      label: ref.ref,
    });
    return point;
  };

  const liveView: LiveView = {
    get isOpen() {
      return liveOpen;
    },
    transport: { kind: 'image-frames', label: 'safaridriver', mimeType: 'image/jpeg' },
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

  return {
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

    /**
     * **見える大きさ**（CSS 画素・2026-09-25・人の指示）。
     *
     * > Firefox は優先度低いですが、**Safari はひつようでしょうね。**
     *
     * 無いと実行側が**指した場所を丸ごと捨てる** —— 赤い枠も矢印も出ない。
     * **覚えない。**窓は走っている間に大きさが変わる（C87）。
     */
    async screenSize(): Promise<{ width: number; height: number }> {
      ensureOpen();
      const size = parseViewport(await evaluate(viewportScript()));
      if (size === undefined) {
        // 握り潰さない。**当て推量の大きさは、見当違いの所を押させる。**
        throw new AdapterError(KIND, 'ブラウザの見える大きさを読めなかった');
      }
      return size;
    },

    /**
     * **見る場所を、押さずに指す**（C85）。
     *
     * 探し方は押すときと**同じ道**（`resolvePoint`）。別の探し方を作ると、
     * **指した所と押す所がずれる。**
     */
    async locate(ref: string): Promise<boolean> {
      ensureOpen();
      try {
        await resolvePoint({ at: 'element', ref });
        return true;
      } catch {
        return false;
      }
    },

    async act(action: Action): Promise<void> {
      ensureOpen();

      if (action.kind === 'launch') {
        await client.post('/url', { url: action.app });
      } else if (action.kind === 'tap') {
        await client.post('/actions', { actions: w3cPointer(await resolvePoint(action.target)) });
      } else if (action.kind === 'drag') {
        await client.post('/actions', {
          actions: w3cDrag(await resolvePoint(action.from), await resolvePoint(action.to)),
        });
      } else if (action.kind === 'type') {
        if (action.target !== undefined) {
          await client.post('/actions', { actions: w3cPointer(await resolvePoint(action.target)) });
        }
        await client.post('/actions', { actions: w3cType(action.text) });
      } else if (action.kind === 'key') {
        await client.post('/actions', { actions: w3cType(action.key) });
      } else {
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
        '{ html: document.documentElement.outerHTML, text: document.body ? document.body.innerText : "" }',
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
        throw new AdapterError(KIND, 'Safari の画面を撮れなかった（空が返った）');
      }
      return { format: 'png', bytes, capturedAt: now().toISOString() };
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      liveOpen = false;
      await deps.cleanup();
    },
  };
}
