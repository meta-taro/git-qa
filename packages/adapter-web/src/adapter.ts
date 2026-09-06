import { AdapterError } from '@git-qa/core';
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

import { createCdpClient } from './cdp.js';
import type { CdpClient } from './cdp.js';
import { launchBrowser } from './browser.js';
import type { RunningBrowser } from './browser.js';
import { findElementScript, parseFoundPoint } from './find.js';
import { httpOriginFromWs, pickPageTarget } from './launch.js';
import type { BrowserTarget } from './launch.js';
import { createScreencast } from './screencast.js';
import { connectCdpSocket } from './socket.js';

/**
 * 人が持っているブラウザを見て触るアダプタ（C54 / Issue 015）。
 *
 * **ここは配線。**判断のある所は分けてある。
 * 番号の付け外しは `cdp.ts`、起こし方は `launch.ts`、絵の運び方は `screencast.ts`。
 * どれもブラウザを起こさずに検査してある。
 */

const KIND = 'web';

export interface WebAdapterOptions {
  /** 検証する相手。**シートの「# 対象:」が宣言した URL**（C40）。 */
  readonly build: TargetBuild;
  /** 最初に開く場所。省略すると `build.source` を URL として使う。 */
  readonly url?: string;
  readonly browserPath?: string;
  /** 窓の大きさ。**同じ幅で見ないと、崩れの有無を比べられない。** */
  readonly size?: { readonly width: number; readonly height: number };
  readonly now?: () => Date;
}

const capabilities: AdapterCapabilities = {
  // Web の画面の状態は DOM。アクセシビリティツリーとは別物なので潰さない（C24）。
  observation: 'dom',
  // 録画はまだ持たない。**「できない」を黙って `failed` にしない**（C20）。
  recording: false,
  // ブラウザは IME を通さずそのまま入る。**日本語も送れる。**
  textInput: 'any',
};

/** 対象の一覧を聞いて、人が見る 1 枚の繋ぎ先を返す。 */
async function findPage(devToolsUrl: string): Promise<string> {
  const origin = httpOriginFromWs(devToolsUrl);
  if (origin === undefined) {
    throw new AdapterError(KIND, `ブラウザの繋ぎ先を読めない（${devToolsUrl}）`);
  }

  const response = await fetch(`${origin}/json/list`);
  if (!response.ok) {
    throw new AdapterError(
      KIND,
      `ブラウザに開いている画面を聞けなかった（${String(response.status)}）`,
    );
  }

  const page = pickPageTarget((await response.json()) as BrowserTarget[]);
  if (page === undefined) {
    // **黙って空の絵を返さない。**繋げなかったことと、何も映っていないことは別。
    throw new AdapterError(KIND, 'ブラウザに見る画面が 1 枚も無い');
  }
  return page;
}

export function createWebAdapter(options: WebAdapterOptions): TargetAdapter {
  const now = options.now ?? (() => new Date());

  return {
    kind: KIND,
    capabilities,

    async connect(): Promise<TargetSession> {
      let browser: RunningBrowser | undefined;
      let cdp: CdpClient | undefined;

      try {
        browser = await launchBrowser({
          ...(options.browserPath === undefined ? {} : { browserPath: options.browserPath }),
          ...(options.size === undefined ? {} : { size: options.size }),
        });
        cdp = createCdpClient(await connectCdpSocket(await findPage(browser.devToolsUrl)));

        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        const start = options.url ?? options.build.source;
        // **行き先はシートが宣言したものだけ**（C40）。ここで別の場所へ行かない。
        await cdp.send('Page.navigate', { url: start });

        return createSession({ cdp, browser, build: options.build, now });
      } catch (error) {
        // 掴んだまま投げない。**起こしたブラウザを残さない。**
        await cdp?.close().catch(() => undefined);
        await browser?.close().catch(() => undefined);
        throw error;
      }
    },
  };
}

interface SessionDeps {
  readonly cdp: CdpClient;
  readonly browser: RunningBrowser;
  readonly build: TargetBuild;
  readonly now: () => Date;
}

function createSession(deps: SessionDeps): TargetSession {
  const { cdp, browser, build, now } = deps;
  const cast = createScreencast(cdp);
  let closed = false;
  let liveOpen = false;

  const ensureOpen = (): void => {
    if (closed) throw new AdapterError(KIND, 'ブラウザとの接続はもう閉じている');
  };

  const liveView: LiveView = {
    get isOpen() {
      return liveOpen;
    },
    transport: { kind: 'image-frames', label: 'chrome screencast', mimeType: 'image/jpeg' },
    open() {
      ensureOpen();
      liveOpen = true;
      return Promise.resolve();
    },
    async close() {
      liveOpen = false;
      await cast.close();
    },
    frames() {
      if (!liveOpen) {
        // 開く前に読もうとしている。空を返すと「映像が来ない」に化ける。
        throw new AdapterError(KIND, '映像を出す準備ができていない（ライブビューを開く前）');
      }
      return cast.frames();
    },
  };

  const recording: RecordingControl = {
    requested: false,
    start: () => Promise.resolve(),
    // **できないことを `failed` にしない**（C20）。持っていないと言う。
    stop: () =>
      Promise.resolve({ state: 'unsupported' as const, reason: 'ウェブの録画はまだ持っていない' }),
  };

  return {
    target: { kind: KIND, browser: 'chrome', build },
    liveView,
    recording,
    get isClosed() {
      return closed;
    },

    async act(action: Action): Promise<void> {
      ensureOpen();
      await dispatch(cdp, action);
    },

    async observe(): Promise<Observation> {
      ensureOpen();
      // **DOM をそのまま持つ。**共通の木へ潰すと、潰した時点で情報が落ちる（C24）。
      //
      // あわせて**ブラウザが出した「読める文字」**（`innerText`）も持つ。
      // HTML から自分で剥がすと `<script>` の中身や `display: none` の文字まで
      // 「表示されている」ことになり、**通ってはいけないケースが通る。**
      const result = await cdp.send('Runtime.evaluate', {
        expression:
          '({ html: document.documentElement.outerHTML, text: document.body ? document.body.innerText : "" })',
        returnByValue: true,
      });
      const value = (result['result'] as { value?: unknown } | undefined)?.value;
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
      const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const data = result['data'];
      if (typeof data !== 'string' || data === '') {
        throw new AdapterError(KIND, 'ブラウザの画面を撮れなかった（空が返った）');
      }
      return {
        format: 'png',
        bytes: new Uint8Array(Buffer.from(data, 'base64')),
        capturedAt: now().toISOString(),
      };
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      liveOpen = false;
      // 読み手を先に切る。逆にすると、絵の出どころが消えた口へ繋ぎに行く。
      await cast.close().catch(() => undefined);
      await cdp.close().catch(() => undefined);
      await browser.close();
    },
  };
}

/**
 * 画面の文字から、触る場所を決める。
 *
 * 実物の検証シートは「「保存」をクリックする」と書く。**座標では書かない。**
 * 見つからなければ、Android 側と同じ言い方で落ちる（人が次に何をすればよいか分かる形）。
 */
async function resolvePoint(cdp: CdpClient, ref: PointerRef): Promise<{ x: number; y: number }> {
  if (ref.at === 'point') return { x: ref.x, y: ref.y };

  const result = await cdp.send('Runtime.evaluate', {
    expression: findElementScript(ref.ref),
    returnByValue: true,
  });
  const point = parseFoundPoint((result['result'] as { value?: unknown } | undefined)?.value);
  if (point === undefined) {
    throw new AdapterError(KIND, `画面に見つからない要素: ${JSON.stringify(ref.ref)}`);
  }
  return point;
}

/** 人と AI の操作を、ブラウザの言葉へ移す。 */
async function dispatch(cdp: CdpClient, action: Action): Promise<void> {
  if (action.kind === 'launch') {
    // **行き先はシートが宣言したものだけ**（C40）。表示名からの推測はしない。
    await cdp.send('Page.navigate', { url: action.app });
    return;
  }

  if (action.kind === 'type') {
    // 入力先が書かれていれば、そこを触ってから送る（欄が違うと、打った文字が消える）。
    if (action.target !== undefined) {
      const point = await resolvePoint(cdp, action.target);
      for (const type of ['mousePressed', 'mouseReleased'] as const) {
        await cdp.send('Input.dispatchMouseEvent', {
          type,
          x: point.x,
          y: point.y,
          button: 'left',
          clickCount: 1,
        });
      }
    }
    // **IME を通らない Android と違い、ブラウザはそのまま入る。**日本語も送れる。
    await cdp.send('Input.insertText', { text: action.text });
    return;
  }

  if (action.kind === 'key') {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: action.key });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: action.key });
    return;
  }

  if (action.kind === 'tap') {
    const point = await resolvePoint(cdp, action.target);
    // **触る前に、そこへポインタを動かす。**hover でしか出ないものがある。
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    for (const type of ['mousePressed', 'mouseReleased'] as const) {
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
      });
    }
    return;
  }

  // swipe。ブラウザではスクロールとして送る（指でなぞる相手ではない）。
  const from = await resolvePoint(cdp, action.from);
  const to = await resolvePoint(cdp, action.to);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: from.x,
    y: from.y,
    deltaX: from.x - to.x,
    deltaY: from.y - to.y,
  });
}
