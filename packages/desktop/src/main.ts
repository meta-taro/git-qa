import { renderColumns } from './render.js';
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

renderColumns(root);

/**
 * 端末に繋いでいるときだけ、中央カラムを映像に差し替える。
 *
 * **繋いでいないのに空の枠を出さない。**映らないのか繋いでいないのかが人に分からなくなる。
 */
async function startLiveView(container: HTMLElement, url: string): Promise<void> {
  if (!(await isLiveViewSupported())) {
    // engine ごとに違う（macOS の WebKit で実際に落ちた・ADR 0002）。黙って空の枠にしない。
    throw new Error('この webview は H.264 の復号に対応していない');
  }

  // 実寸は最初の絵が来た時点で合わせ直す（view.ts）。ここは仮の大きさ。
  const surface = mountLiveView(container, { width: 1080, height: 2220 });
  const player = createLivePlayer({
    createDecoder: createWebCodecsDecoder,
    onFrame: (frame) => surface.draw(frame),
  });

  await pumpLiveStream(await openLiveStream(url), player);
}

const liveUrl = liveStreamUrlFromLocation(window.location.search);
if (liveUrl !== undefined) {
  startLiveView(root, liveUrl).catch((error: unknown) => {
    // **映らない理由を画面に出す。**console だけだと人には見えず、待ち続けることになる。
    console.error('[live-view]', error);
    showLiveViewError(
      root,
      `ライブ映像を出せない: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}
