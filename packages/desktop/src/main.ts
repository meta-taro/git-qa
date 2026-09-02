import type { HumanInput, SessionState } from '@git-qa/core/session';

import { resolveLocale } from './i18n/index.js';
import { setLocale, t } from './i18n/current.js';
import { startAppearanceSync } from './appearance.js';
import { connectionStatus, renderOnboarding } from './onboarding/index.js';
import { renderColumns } from './render.js';
import { installColumnResizers } from './resize.js';
import { connectControl, controlUrlFromLocation, sendHumanInput } from './session/control.js';
import { commandForKey } from './session/keys.js';
import { installDeviceTouch } from './session/touch.js';
import { renderSession, showSessionError } from './session/view.js';
import { createLivePlayer } from './live/player.js';
import { liveStreamUrlFromLocation, openLiveStream, pumpLiveStream } from './live/stream.js';
import { mountLiveView, showLiveViewError } from './live/view.js';
import { createWebCodecsDecoder, isLiveViewSupported } from './live/webcodecs.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  // 握り潰さない（product-baseline §8）。index.html と食い違ったら起動時に分かるようにする。
  throw new Error('#app が index.html に無い');
}

// 描く前に言語を決める。決める前に描くと、一瞬だけ別の言語が出る。
setLocale(
  resolveLocale(
    [...navigator.languages],
    new URLSearchParams(window.location.search).get('lang') ?? undefined,
  ),
);

/** 実行の状態。**打鍵と、人が端末を触る操作の両方がここを見る。** */
let latest: SessionState | undefined;

renderColumns(root);
// 区切りは、カラムを描いた後に差し込む（描き直すと消えるため）。
installColumnResizers(root);
// 外観の切り替えはメニューから（`src-tauri/src/menu.rs`）。**画面には部品を置かない。**
void startAppearanceSync().catch((error: unknown) => {
  console.error('[appearance] メニューと繋がらない', error);
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
  renderOnboarding(container, 'running');

  if (!(await isLiveViewSupported())) {
    // engine ごとに違う（macOS の WebKit で実際に落ちた・ADR 0002）。黙って空の枠にしない。
    throw new Error(t('live.unsupported'));
  }

  // 実寸は最初の絵が来た時点で合わせ直す（view.ts）。ここは仮の大きさ。
  const surface = mountLiveView(container, { width: 1080, height: 2220 });
  onCanvas(surface.canvas);
  const player = createLivePlayer({
    createDecoder: createWebCodecsDecoder,
    onFrame: (frame) => surface.draw(frame),
  });

  await pumpLiveStream(await openLiveStream(url), player);
}

const liveUrl = liveStreamUrlFromLocation(window.location.search);
const controlUrl = controlUrlFromLocation(window.location.search);

// 繋がっていないときは、**次にやること**を中央に出す（Issue 011）。
renderOnboarding(
  root,
  connectionStatus({
    ...(liveUrl === undefined ? {} : { liveUrl }),
    ...(controlUrl === undefined ? {} : { controlUrl }),
  }),
);

if (liveUrl !== undefined) {
  startLiveView(root, liveUrl, (canvas) => {
    // **人が端末を触れるようにする**（Issue 013）。実行に繋がっているときだけ。
    if (controlUrl === undefined) return;
    installDeviceTouch({
      canvas,
      state: () => latest,
      send: (input) => {
        sendHumanInput(controlUrl, input).catch((error: unknown) => {
          showSessionError(root, error instanceof Error ? error.message : String(error));
        });
      },
    });
  }).catch((error: unknown) => {
    // **映らない理由を画面に出す。**console だけだと人には見えず、待ち続けることになる。
    console.error('[live-view]', error);
    showLiveViewError(
      root,
      t('live.error', { message: error instanceof Error ? error.message : String(error) }),
    );
  });
}

/**
 * 実行器（Node）と繋いでいるときだけ、左右のカラムを実行の状態にする。
 *
 * **ここは配線なので検査していない。**判断のある所（キーの割り当て・状態の描き方・
 * 届いたものの検証）は `session/` にあり、そちらは検査してある。
 */
if (controlUrl !== undefined) {
  connectControl({
    url: controlUrl,
    onState: (state) => {
      latest = state;
      renderSession(root, state);
    },
  });

  window.addEventListener('keydown', (event) => {
    const command = commandForKey(event);
    if (command === undefined) return;

    const caseNo = latest?.awaiting;
    // 待っていないときは何も送らない。**押した打鍵が別のケースへ付くのが一番まずい。**
    if (caseNo === undefined) return;
    event.preventDefault();

    const input: HumanInput =
      command.kind === 'advance'
        ? { kind: 'advance', caseNo }
        : { kind: 'verdict', caseNo, humanResult: command.humanResult };

    sendHumanInput(controlUrl, input).catch((error: unknown) => {
      showSessionError(root, error instanceof Error ? error.message : String(error));
    });
  });
}
