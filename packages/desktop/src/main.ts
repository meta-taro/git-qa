import type { HumanInput, SessionState } from '@git-qa/core/session';

import { attachConsoleToLog } from './console-log.js';
import { setLocale, t } from './i18n/current.js';
import { effectiveLocale, loadLocaleChoice, startLocaleSync } from './i18n/sync.js';
import { defaultStore } from './setting-store.js';
import { startAppearanceSync } from './appearance.js';
import { connectionStatus, renderOnboarding } from './onboarding/index.js';
import { fetchSetupState, requestStart, resolveSetupUrl } from './setup/client.js';
import { renderSetup } from './setup/view.js';
import type { ConnectionStatus } from './onboarding/index.js';
import { renderColumns, updateColumnTexts } from './render.js';
import { installColumnResizers } from './resize.js';
import { connectControl, controlUrlFromLocation, sendHumanInput } from './session/control.js';
import { commandForKey } from './session/keys.js';
import type { KeyCommand } from './session/keys.js';
import { reportDiagnostics, type DiagnosticsReport } from './session/diagnostics.js';
import { startMenuActions } from './session/menu-actions.js';
import { installDeviceTouch } from './session/touch.js';
import { installVerdictButtons, renderSession, showSessionError } from './session/view.js';
import { createLivePlayer } from './live/player.js';
import { liveStreamUrlFromLocation, openLiveStream, pumpLiveStream } from './live/stream.js';
import { mountLiveView, showLiveViewError } from './live/view.js';
import { createWebCodecsDecoder, isLiveViewSupported } from './live/webcodecs.js';
import './styles.css';

// 【一時】どこまで動いたかを外から見るための印。原因が分かったら消す。
void fetch(
  `${new URLSearchParams(window.location.search).get('setup') ?? ''}/state?probe=top`,
).catch(() => undefined);

// **画面の中で起きたことを、Node 側のログへ流す。**
// これが無いと、映らない・動かないときに「人に聞く」しか手が無い。
void attachConsoleToLog();

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  // 握り潰さない（product-baseline §8）。index.html と食い違ったら起動時に分かるようにする。
  throw new Error('#app が index.html に無い');
}

/** 絞り込み済みの参照。**巻き上げられる関数の中からも使える**ようにするため。 */
const app: HTMLElement = root;

// 描く前に言語を決める。決める前に描くと、一瞬だけ別の言語が出る。
setLocale(effectiveLocale(loadLocaleChoice(defaultStore()), navigator.languages));

/** 実行の状態。**打鍵と、人が端末を触る操作の両方がここを見る。** */
let latest: SessionState | undefined;

/**
 * 画面の中の様子。**「映っていますか」と人に聞かないと分からない状態を減らす。**
 * 診断の口（`<controlUrl>/diag`）へ定期的に置く。
 */
const diagnostics: {
  decoded: number;
  drawn: number;
  bytes: number;
  lastError?: string;
  canDecode?: boolean;
  canvas?: { width: number; height: number };
  decodeError?: string;
  codec?: string;
  lastFrameAt?: number;
} = { decoded: 0, drawn: 0, bytes: 0 };

/** いま動いている再生。診断で中の様子を読むために持っておく。 */
let livePlayer:
  { readonly stats: { error: string | undefined; codec: string | undefined } } | undefined;

/**
 * いま見ているケース。**実行の進行とは別のカーソル**（Issue 013）。
 * 戻って置き直せるようにするために持つ。
 */
let cursor: number | undefined;

/** いま出ている案内の段階。言語が変わったときに描き直すために覚えておく。 */
let onboarding: ConnectionStatus = 'disconnected';

renderColumns(root);
// 区切りは、カラムを描いた後に差し込む（描き直すと消えるため）。
installColumnResizers(root);
// 外観の切り替えはメニューから（`src-tauri/src/menu.rs`）。**画面には部品を置かない。**
void startAppearanceSync().catch((error: unknown) => {
  console.error('[appearance] メニューと繋がらない', error);
});

/**
 * 言語が変わったときに、いま出ているものを書き直す。
 *
 * **カラムは作り直さない。**作り直すと、見ている映像（canvas）が消える。
 */
const redrawTexts = (): void => {
  updateColumnTexts(root);
  if (latest !== undefined) {
    renderSession(root, latest);
    return;
  }
  renderOnboarding(root, onboarding);
};

// 検証シートを開く道もメニューから（Issue 011）。**開くファイルの場所は画面が持っている。**
void startMenuActions({
  sheetPath: () => latest?.sheetPath,
  onError: (message) => {
    showSessionError(root, message);
  },
}).catch((error: unknown) => {
  console.error('[menu] メニューと繋がらない', error);
});

// 言語の切り替えもメニューから。**OS に従うだけだと、使う人が選べない。**
void startLocaleSync({
  onChange: (locale) => {
    setLocale(locale);
    redrawTexts();
  },
}).catch((error: unknown) => {
  console.error('[i18n] メニューと繋がらない', error);
});

/**
 * 端末に繋いでいるときだけ、中央カラムを映像に差し替える。
 *
 * **繋いでいないのに空の枠を出さない。**映らないのか繋いでいないのかが人に分からなくなる。
 */
async function startLiveView(
  container: HTMLElement,
  url: string,
  onCanvas: (canvas: HTMLCanvasElement) => void,
): Promise<void> {
  // 映像を出す前に案内を片付ける。**残すと映像の上に説明が重なる。**
  onboarding = 'running';
  renderOnboarding(container, onboarding);

  diagnostics.canDecode = await isLiveViewSupported();
  if (diagnostics.canDecode !== true) {
    // engine ごとに違う（macOS の WebKit で実際に落ちた・ADR 0002）。黙って空の枠にしない。
    throw new Error(t('live.unsupported'));
  }

  // 実寸は最初の絵が来た時点で合わせ直す（view.ts）。ここは仮の大きさ。
  const surface = mountLiveView(container, { width: 1080, height: 2220 });
  onCanvas(surface.canvas);
  const player = createLivePlayer({
    createDecoder: createWebCodecsDecoder,
    onFrame: (frame) => {
      diagnostics.decoded += 1;
      surface.draw(frame);
      diagnostics.drawn += 1;
      diagnostics.lastFrameAt = Date.now();
      diagnostics.canvas = { width: surface.canvas.width, height: surface.canvas.height };
    },
  });

  livePlayer = player;

  // 受け取ったバイト数を数える。**0 なら橋まで届いていない**（画面の問題ではない）。
  const counted = (await openLiveStream(url)).pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        diagnostics.bytes += chunk.length;
        controller.enqueue(chunk);
      },
    }),
  );
  await pumpLiveStream(counted, player);
}

const liveUrl = liveStreamUrlFromLocation(window.location.search);
const controlUrl = controlUrlFromLocation(window.location.search);

/**
 * 端末に繋がったら、映像と実行状態を出す。
 *
 * **入口が 2 つある。**起動時に URL で渡される場合（`pnpm run:sheet`）と、
 * 画面で選んで始めた場合（`pnpm app`・Issue 011 段階 3）。**どちらも同じ道を通す。**
 */
const startSession = (live: string, control: string | undefined): void => {
  onboarding = 'running';
  renderOnboarding(root, onboarding);

  startLiveView(root, live, (canvas) => {
    // **人が端末を触れるようにする**（Issue 013）。実行に繋がっているときだけ。
    if (control === undefined) return;
    installDeviceTouch({
      canvas,
      state: () => latest,
      send: (input) => {
        sendHumanInput(control, input).catch((error: unknown) => {
          showSessionError(root, error instanceof Error ? error.message : String(error));
        });
      },
    });
  }).catch((error: unknown) => {
    // **映らない理由を画面に出す。**console だけだと人には見えず、待ち続けることになる。
    console.error('[live-view]', error);
    diagnostics.lastError = error instanceof Error ? error.message : String(error);
    showLiveViewError(
      root,
      t('live.error', { message: error instanceof Error ? error.message : String(error) }),
    );
  });

  if (control === undefined) return;
  startControl(control);
};

// 繋がっていないときは、**次にやること**を中央に出す（Issue 011）。
onboarding = connectionStatus({
  ...(liveUrl === undefined ? {} : { liveUrl }),
  ...(controlUrl === undefined ? {} : { controlUrl }),
});
renderOnboarding(root, onboarding);

if (liveUrl !== undefined) {
  startSession(liveUrl, controlUrl);
} else {
  /**
   * 端末とシートを選んで始める（Issue 011 段階 3）。
   *
   * **入口の URL は 2 通りで来る。**開発中は `?setup=`、配布物ではアプリに聞く
   * （`.app` を叩いたときはクエリが付かない）。
   */
  void (async () => {
    let url: string | undefined;
    try {
      url = await resolveSetupUrl(window.location.search);
    } catch (error: unknown) {
      // **起こせなかった理由を画面に出す。**黙って空の画面を出さない。
      showLiveViewError(app, error instanceof Error ? error.message : String(error));
      return;
    }
    if (url === undefined) return;

    const setupUrl = url;

    const tick = async (): Promise<void> => {
      const state = await fetchSetupState(setupUrl);
      if (state === undefined) return;

      if (state.phase === 'running' && state.liveUrl !== undefined) {
        window.clearInterval(poll);
        renderSetup(app, state, { onStart: () => undefined });
        startSession(state.liveUrl, state.controlUrl);
        return;
      }

      renderSetup(app, state, {
        onStart: (params) => {
          requestStart(setupUrl, params).catch((error: unknown) => {
            showSessionError(app, error instanceof Error ? error.message : String(error));
          });
        },
      });
    };

    /**
     * **ウィンドウが完全に隠れると、macOS が画面の時計を止める。**
     * 止まっている間に実行が始まっていても気づけないので、**戻ってきたら取り直す。**
     */
    const resync = (): void => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);

    const poll = window.setInterval(() => {
      void tick();
    }, 1000);

    // 最初の 1 回は待たずに出す。**開いた直後に空の画面を見せない。**
    await tick();
  })();
}

/**
 * 実行器（Node）と繋ぐ。左右のカラムが実行の状態になる。
 *
 * **ここは配線なので検査していない。**判断のある所（キーの割り当て・状態の描き方・
 * 届いたものの検証）は `session/` にあり、そちらは検査してある。
 */
function startControl(controlUrl: string): void {
  // 画面の中の様子を置き続ける。**繋がっていない / 復号で落ちている / 描いているが見えない**
  // のどれなのかを、人に聞かずに切り分けられるようにする。
  setInterval(() => {
    const report: DiagnosticsReport = {
      decoded: diagnostics.decoded,
      drawn: diagnostics.drawn,
      bytes: diagnostics.bytes,
      href: window.location.href,
      ...(diagnostics.canDecode === undefined ? {} : { canDecode: diagnostics.canDecode }),
      // **復号器が落ちた理由を外へ出す。**握り潰すと、真っ黒の原因が分からない。
      ...(livePlayer?.stats.error === undefined ? {} : { decodeError: livePlayer.stats.error }),
      ...(livePlayer?.stats.codec === undefined ? {} : { codec: livePlayer.stats.codec }),
      ...(diagnostics.lastFrameAt === undefined ? {} : { lastFrameAt: diagnostics.lastFrameAt }),
      ...(diagnostics.canvas === undefined ? {} : { canvas: diagnostics.canvas }),
      ...(diagnostics.lastError === undefined ? {} : { lastError: diagnostics.lastError }),
    };
    void reportDiagnostics(controlUrl, report);
  }, 2000);

  /** 前に見ていた打鍵待ちのケース。カーソルを追従させるかの判断に使う。 */
  let previousAwaiting: number | undefined;

  connectControl({
    url: controlUrl,
    onState: (state) => {
      latest = state;
      // 打鍵待ちが進んだら、見ている所も追いかける（戻って見ている最中は動かさない）。
      if (cursor === undefined || cursor === previousAwaiting) cursor = state.awaiting;
      previousAwaiting = state.awaiting;
      renderSession(app, state, { ...(cursor === undefined ? {} : { cursor }) });
    },
  });

  /** 走り終わったケースだけを行き来する。**まだ走っていないケースには行けない。** */
  const move = (step: -1 | 1): void => {
    const state = latest;
    if (state === undefined) return;
    const visitable = state.cases.filter((c) => c.aiResult !== undefined).map((c) => c.no);
    if (visitable.length === 0) return;

    const at = visitable.indexOf(cursor ?? state.awaiting ?? visitable[0]!);
    const next = visitable[Math.min(Math.max(at + step, 0), visitable.length - 1)];
    if (next === undefined) return;
    cursor = next;
    renderSession(app, state, { cursor });
  };

  /** 打鍵とクリックで、まったく同じ道を通す。 */
  const place = (command: KeyCommand): void => {
    if (command.kind === 'prev' || command.kind === 'next') {
      move(command.kind === 'prev' ? -1 : 1);
      return;
    }

    // **見ているケースへ置く。**戻って直しているなら、そのケースが相手になる。
    const caseNo = cursor ?? latest?.awaiting;
    if (caseNo === undefined) return;

    const input: HumanInput =
      command.kind === 'advance'
        ? { kind: 'advance', caseNo }
        : { kind: 'verdict', caseNo, humanResult: command.humanResult };

    sendHumanInput(controlUrl, input).catch((error: unknown) => {
      showSessionError(app, error instanceof Error ? error.message : String(error));
    });
  };

  window.addEventListener('keydown', (event) => {
    const command = commandForKey(event);
    if (command === undefined) return;
    event.preventDefault();
    place(command);
  });

  // **打鍵だけにしない。**初めて触る人は、どのキーが何をするか知らない。
  installVerdictButtons(app, (key) => {
    const command = commandForKey({ key });
    if (command !== undefined) place(command);
  });
}
