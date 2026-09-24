import { keyEvents } from './keys.js';
import { AdapterError } from '@git-qa/core';
import type {
  Action,
  AdapterCapabilities,
  BrowserProfileKind,
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
import { attachedNote, devToolsUrlFrom } from './attach.js';
import { profileKind } from './profile.js';
import {
  findElementScript,
  listElementsScript,
  disabledElementMessage,
  foundDisabledOnly,
  missingElementMessage,
  parseElementNames,
  parseFoundPoint,
} from './find.js';
import { browserLabel, httpOriginFromWs, parseBrowserVersion, pickPageTarget } from './launch.js';
import type { BrowserKind, BrowserTarget } from './launch.js';
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
  /**
   * 何処を見に行ったか（シートの `行き先`）。**「何を検証したか」（`build.source`）と分ける**
   * —— 外部レビュー meta-taro/git-qa#22。無ければ持たない。
   */
  readonly destination?: string;
  /** 最初に開く場所。省略すると `build.source` を URL として使う。 */
  readonly url?: string;
  readonly browserPath?: string;
  /**
   * ブラウザのプロファイルの置き場所（外部レビュー meta-taro/git-qa#26）。
   * **渡すと、終わりに消さない**（ログイン済みの状態を保つための口）。
   */
  readonly userDataDir?: string;
  /** **その中の、どのプロファイルか**（外部レビュー meta-taro/git-qa#35）。 */
  readonly profileDirectory?: string;
  /**
   * **既に起きているブラウザの繋ぎ先**（meta-taro/git-qa#30）。
   *
   * 渡すと**起こさない・閉じない。**Playwright が起こしたブラウザに繋いで、
   * **前準備はそちら、判定はこちら**という分担にするための口。
   */
  readonly attachTo?: string;
  /**
   * どのブラウザで見るか。**選ばれていれば、それ以外は探さない。**
   *
   * 「Chrome で見る」と言われたのに Edge が起きたら、
   * **証跡に書いてあるものと、実際に見たものが食い違う。**
   */
  readonly browser?: BrowserKind;
  /** 窓の大きさ。**同じ幅で見ないと、崩れの有無を比べられない。** */
  readonly size?: { readonly width: number; readonly height: number };
  /**
   * 操作のあと、画面が落ち着くのを待つ時間（ms）。
   *
   * **押した直後の画面は、まだ前の画面。**データが多いページほど、描き終わるまで時間がかかる。
   * 待たずに読むと、**出るはずのものが「出ていない」ことになって落ちる。**
   */
  readonly settleMs?: number;
  /** 読み込みが終わるのを待つ上限（ms）。**待っても終わらなければ、そのまま進む。** */
  readonly loadTimeoutMs?: number;
  readonly now?: () => Date;
}

/** 押した直後の画面は、まだ前の画面（Android の `settleMs` と同じ考え方）。 */
const DEFAULT_SETTLE_MS = 300;
/** 読み込みを待つ上限。**永久には待たない**（待ち続けると、止まった理由が分からない）。 */
const DEFAULT_LOAD_TIMEOUT_MS = 15_000;

const capabilities: AdapterCapabilities = {
  // Web の画面の状態は DOM。アクセシビリティツリーとは別物なので潰さない（C24）。
  observation: 'dom',
  // 録画はまだ持たない。**「できない」を黙って `failed` にしない**（C20）。
  recording: false,
  // ブラウザは IME を通さずそのまま入る。**日本語も送れる。**
  textInput: 'any',
  // 番号まで載せるようにして、実物で効くことを確かめた（外部レビュー #6・2026-09-13）。
  keyInput: true,
  // 行き先は URL。
  appId: 'package-or-url',
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
        /**
         * **既に起きているブラウザへ繋ぐ**（meta-taro/git-qa#30）。
         *
         * Playwright が起こしたブラウザに繋げば、**前準備はそちら、判定はこちら**にできる。
         * **起こさない・閉じない** —— 他人のものを片付けない（#20 の逆側の間違い）。
         */
        if (options.attachTo !== undefined) {
          const devToolsUrl = devToolsUrlFrom(options.attachTo);
          if (devToolsUrl === undefined) {
            throw new AdapterError(
              KIND,
              `繋ぎ先を読めない: ${JSON.stringify(options.attachTo)}（http://127.0.0.1:9222 のような形で渡す）`,
            );
          }
          // **閉じない。**持ち主（Playwright・人）が閉じる。
          browser = {
            devToolsUrl,
            userDataDir: '',
            binaryPath: '',
            // **閉じない。**持ち主（Playwright・人）が閉じる。
            close: () => Promise.resolve(),
          };
          const note = attachedNote(options.attachTo);
          if (note !== undefined) console.log(`[git-qa] ${note}`);
        }

        browser ??= await launchBrowser({
          ...(options.browserPath === undefined ? {} : { browserPath: options.browserPath }),
          ...(options.userDataDir === undefined ? {} : { userDataDir: options.userDataDir }),
          ...(options.profileDirectory === undefined
            ? {}
            : { profileDirectory: options.profileDirectory }),
          ...(options.browser === undefined ? {} : { browser: options.browser }),
          ...(options.size === undefined ? {} : { size: options.size }),
          // **片付けたことは黙らない**（meta-taro/git-qa#20）。
          onNote: (message) => {
            console.log(`[git-qa] ${message}`);
          },
        });
        cdp = createCdpClient(await connectCdpSocket(await findPage(browser.devToolsUrl)));

        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        /**
         * **何で見たかを証跡に残す。**同じ画面でも版が違えば結果が変わる。
         * 後から「どのブラウザのどの版で見たか」が読めないと、証跡として弱い。
         */
        const version = await cdp.send('Browser.getVersion').catch(() => ({}));
        const label = browserLabel(browser.binaryPath, parseBrowserVersion(version));

        const start = options.url ?? options.build.source;
        // **行き先はシートが宣言したものだけ**（C40）。ここで別の場所へ行かない。
        await cdp.send('Page.navigate', { url: start });
        await waitForLoad(cdp, options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS);

        return createSession({
          cdp,
          browser,
          now,
          build: options.build,
          ...(options.destination === undefined ? {} : { destination: options.destination }),
          browserLabel: label,
          profile: profileKind(options.userDataDir),
          ...(options.settleMs === undefined ? {} : { settleMs: options.settleMs }),
          ...(options.loadTimeoutMs === undefined ? {} : { loadTimeoutMs: options.loadTimeoutMs }),
        });
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
  /** 何処を見に行ったか（シートの `行き先`・外部レビュー #22）。 */
  readonly destination?: string;
  readonly now: () => Date;
  /** 証跡に残す「何で見たか」。例: `Google Chrome（Chrome/141.0.7390.55）`。 */
  readonly browserLabel: string;
  /** **どのプロファイルで見たか**（外部レビュー meta-taro/git-qa#35）。 */
  readonly profile?: BrowserProfileKind;
  readonly settleMs?: number;
  readonly loadTimeoutMs?: number;
}

/**
 * 読み込みが終わるのを待つ。
 *
 * `Page.navigate` は**行き先が決まった時点**で返る。中身が描き終わるのは、そのあと。
 * **データが多いページほど差が開く。**待たずに読むと、出るはずのものが
 * 「出ていない」ことになって落ちる。
 *
 * **永久には待たない。**上限を過ぎたら、そのまま進む（待ち続けると理由が分からない）。
 */
async function waitForLoad(cdp: CdpClient, limitMs: number): Promise<void> {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    const result = await cdp
      .send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })
      .catch(() => undefined);
    const state = (result?.['result'] as { value?: unknown } | undefined)?.value;
    if (state === 'complete') return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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
    // **何で見たかは、run.json の `target.browser` に残る。**決め打ちにしない。
    target: {
      kind: KIND,
      browser: deps.browserLabel,
      /**
       * **どのプロファイルで見たか**（#35）。
       *
       * まっさら・用意されたもの・**その人の私物**は、同じ結果でも意味が違う。
       * 「その権限の人には見えた」でしかないのか、**私物の環境を触ったのか**が
       * 読む人に分からないと、証跡として弱い。
       */
      ...(deps.profile === undefined ? {} : { profile: deps.profile }),
      build,
      // **何処を見に行ったか**（シートの `行き先`・外部レビュー #22）。
      ...(deps.destination === undefined ? {} : { destination: deps.destination }),
    },
    liveView,
    recording,
    get isClosed() {
      return closed;
    },

    async act(action: Action): Promise<void> {
      ensureOpen();
      await dispatch(cdp, action);
      // **押した直後の画面は、まだ前の画面。**落ち着くのを待ってから次へ。
      await new Promise((resolve) => setTimeout(resolve, deps.settleMs ?? DEFAULT_SETTLE_MS));
      // 行き先が変わったなら、描き終わるまで待つ。
      await waitForLoad(cdp, deps.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS);
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

      /**
       * **押せる名前も一緒に持つ**（2026-09-19・MCP 拡充）。
       *
       * `element_tap` は名前で押せるのに、**どんな名前が在るかを知る口が無かった。**
       * **集め方は探すときと同じ**（`listElementsScript`）—— 別の集め方を作ると、
       * **並んだのに押せない名前**が出る。
       *
       * **取れなくても観測は返す。**名前が無いことは、画面が読めないことではない。
       */
      const names = await cdp
        .send('Runtime.evaluate', { expression: listElementsScript(), returnByValue: true })
        .then((said) => (said['result'] as { value?: unknown } | undefined)?.value)
        .catch(() => undefined);

      return {
        kind: KIND,
        capturedAt: now().toISOString(),
        raw: {
          html: typeof observed?.html === 'string' ? observed.html : '',
          text: typeof observed?.text === 'string' ? observed.text : '',
          elementNames: parseElementNames(names),
        },
      };
    },

    async screenshot(): Promise<Screenshot> {
      ensureOpen();
      /**
       * **webp で受け取る**（2026-09-11）。CDP がそのまま出せるので、
       * 変換の道具が要らない。**証跡はケースごとに積むので、小ささが効く。**
       */
      const result = await cdp.send('Page.captureScreenshot', { format: 'webp' });
      const data = result['data'];
      if (typeof data !== 'string' || data === '') {
        throw new AdapterError(KIND, 'ブラウザの画面を撮れなかった（空が返った）');
      }
      return {
        format: 'webp',
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
  const said = (result['result'] as { value?: unknown } | undefined)?.value;
  const point = parseFoundPoint(said);
  if (point === undefined) {
    /**
     * **「見つからない」と「見つかったが押せない状態」を分ける**
     * （外部レビュー meta-taro/git-qa#41）。
     *
     * 混ぜると、**シートの書き方が悪いのか、画面がその状態なのか**が分からない。
     * **押していないのに手順が成功として残る**のは、いちばんやってはいけない形（C20）。
     */
    if (foundDisabledOnly(said)) throw new AdapterError(KIND, disabledElementMessage(ref.ref));
    // **探した所を言う**（#28）。「そんな要素は無い」だけだと、実物を見ている人と食い違う。
    throw new AdapterError(KIND, missingElementMessage(ref.ref));
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
    // **番号まで載せる。**`key` だけでは、Chrome は既定の動作（送信・改行）を起こさない
    // （2026-09-13 に実物で確かめた・外部レビュー #6）。
    for (const event of keyEvents(action.key)) {
      await cdp.send('Input.dispatchKeyEvent', { ...event });
    }
    return;
  }

  if (action.kind === 'drag') {
    /**
     * 掴んで、動かして、離す。
     *
     * **1 回で運ばない。**掴んだ先が動きを追うのは「途中の動き」を見てからなので、
     * 押して即離すと**何も起きない**（並べ替えの UI で実際にそうなる）。
     */
    const from = await resolvePoint(cdp, action.from);
    const to = await resolvePoint(cdp, action.to);

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: from.x,
      y: from.y,
      button: 'left',
      clickCount: 1,
    });

    const steps = 10;
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(from.x + ((to.x - from.x) * i) / steps),
        y: Math.round(from.y + ((to.y - from.y) * i) / steps),
        button: 'left',
        buttons: 1,
      });
    }

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: to.x,
      y: to.y,
      button: 'left',
      clickCount: 1,
    });
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
