import type { LivePlayer } from './player.js';

/**
 * 橋（`@git-qa/live-bridge`）から届く生 H.264 を、再生へ流し込む。
 *
 * **URL は画面側では決められない。**流し元（アダプタ）を持っているのは Node 側なので、
 * 起動時に渡してもらう。
 */

/** `?live=<url>` から読む。無ければ undefined（端末に繋いでいない状態）。 */
export function liveStreamUrlFromLocation(search: string): string | undefined {
  const raw = new URLSearchParams(search).get('live');
  if (raw === null || raw === '') return undefined;

  // 受け取った文字列をそのまま fetch しない。**localhost 以外へは繋がない**
  // （ここを流れるのは検証中の端末の画面・PRD §10）。
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  return local && url.protocol === 'http:' ? url.toString() : undefined;
}

/** 届いた順に再生へ渡す。ストリームが尽きたら `end()` する。 */
export async function pumpLiveStream(
  stream: ReadableStream<Uint8Array>,
  player: LivePlayer,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      if (signal?.aborted === true) return;
      const next = await reader.read();
      if (next.done) return;
      player.push(next.value);
    }
  } finally {
    // 途中で止めた場合も、溜まっている分を吐いてから閉じる。
    player.end();
    reader.releaseLock();
  }
}

/** 橋へ繋ぐ。**ここは実際の通信なので検査していない。** */
export async function openLiveStream(url: string): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`ライブ映像に繋がらない: ${String(response.status)}`);
  }
  return response.body;
}
