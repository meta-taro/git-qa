import { parseSessionState } from '@git-qa/core/session';
import type { HumanInput, SessionState } from '@git-qa/core/session';

import { localHttpUrlFromLocation } from '../local-url.js';

/**
 * 実行器（Node）との線。状態を受け取り、打鍵を返す。
 *
 * **橋を通って来るものは信用しない。**形が違えば捨てる（`parseSessionState`）。
 */

/** SSE の最小の口。**本物の `EventSource` は webview の中でしか動かない**ので差し替えられる形にする。 */
export interface EventSourceLike {
  addEventListener(type: 'message', listener: (event: { data: string }) => void): void;
  close(): void;
}

export interface ControlClient {
  close(): void;
}

export interface ConnectControlOptions {
  readonly url: string;
  readonly onState: (state: SessionState) => void;
  readonly createEventSource?: (url: string) => EventSourceLike;
}

/** `?control=<url>` から読む。規則は映像と同じ。 */
export function controlUrlFromLocation(search: string): string | undefined {
  return localHttpUrlFromLocation(search, 'control');
}

export function connectControl(options: ConnectControlOptions): ControlClient {
  const create =
    options.createEventSource ?? ((url: string): EventSourceLike => new EventSource(url));
  const source = create(`${options.url}/events`);

  source.addEventListener('message', (event) => {
    let raw: unknown;
    try {
      raw = JSON.parse(event.data);
    } catch {
      // 読めないものは捨てる。**半分読めた一覧を人へ見せない。**
      return;
    }
    const state = parseSessionState(raw);
    if (state !== undefined) options.onState(state);
  });

  return {
    close(): void {
      source.close();
    },
  };
}

/**
 * 打鍵を実行器へ送る。
 *
 * **受け取ってもらえなければ落とす。**押したのに届いていない状態で黙ると、
 * 人は置いたつもりで次へ進み、証跡には誰も見ていないことになる。
 */
export async function sendHumanInput(
  url: string,
  input: HumanInput,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${url}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (response.status !== 202) {
    throw new Error(`打鍵を送れなかった: ${String(response.status)}`);
  }
}
