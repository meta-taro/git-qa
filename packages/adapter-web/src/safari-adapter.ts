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

import { findElementScript, parseFoundPoint } from './find.js';
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
  readonly url?: string;
  readonly settleMs?: number;
  readonly startTimeoutMs?: number;
  readonly now?: () => Date;
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

        return createSession({ client, cleanup, options, now, label });
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

function createSession(deps: SessionDeps): TargetSession {
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
    target: { kind: KIND, browser: deps.label, build: deps.options.build },
    liveView,
    recording,
    get isClosed() {
      return closed;
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
