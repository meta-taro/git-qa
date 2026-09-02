import { afterEach, describe, expect, it } from 'vitest';

import { startLiveBridge } from '../src/index.js';
import type { LiveBridge } from '../src/index.js';

/**
 * 制御チャネル — 実行器（Node）と画面（webview）の間で、状態と打鍵をやりとりする。
 *
 * **映像と同じ橋に相乗りする。**口を増やすと、守り（127.0.0.1 限定・無作為の token）を
 * 2 箇所で維持することになり、片方だけ緩んでも気づけない。
 */

const source = () =>
  // eslint-disable-next-line @typescript-eslint/require-await
  async function* () {
    yield new Uint8Array([0, 0, 1, 7]);
  };

let bridge: LiveBridge | undefined;
afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

/** SSE を count 件ぶん読む。読み終えたら切る。 */
async function readEvents(url: string, count: number): Promise<unknown[]> {
  const res = await fetch(url);
  expect(res.ok).toBe(true);
  expect(res.headers.get('content-type')).toContain('text/event-stream');

  const body: ReadableStream<Uint8Array> | null = res.body;
  expect(body).not.toBeNull();
  const reader = body!.getReader();
  const decoder = new TextDecoder();
  const events: unknown[] = [];
  let buffer = '';
  while (events.length < count) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (line !== undefined) events.push(JSON.parse(line.slice('data: '.length)));
    }
  }
  await reader.cancel();
  return events;
}

const post = (url: string, body: string): Promise<Response> =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

describe('制御チャネル', () => {
  it('publish したものが、繋いでいる画面へ届く', async () => {
    bridge = await startLiveBridge({ source: source() });
    const events = readEvents(`${bridge.controlUrl}/events`, 1);
    // 繋がるのを待ってから流す。繋ぐ前の publish は次の検査で見る。
    await new Promise((r) => setTimeout(r, 50));
    bridge.publish({ caseNo: 3, aiResult: 'BLOCKED' });

    expect(await events).toEqual([{ caseNo: 3, aiResult: 'BLOCKED' }]);
  });

  it('publish が 1 度も無くても、繋いだ時点で線が開く', async () => {
    // **ここは実際に詰まった。**書くものが無いとヘッダが送り出されず、
    // 画面側の `fetch` が返らないまま「繋がらない」ように見えていた。
    bridge = await startLiveBridge({ source: source() });

    const res = await fetch(`${bridge.controlUrl}/events`);
    expect(res.status).toBe(200);
    await res.body!.cancel();
  });

  it('後から繋いだ画面にも、いまの状態がすぐ届く', async () => {
    // **画面は実行の途中で開き直される。**繋いだ時に何も出ないと、人は空の枠を見ることになる。
    bridge = await startLiveBridge({ source: source() });
    bridge.publish({ caseNo: 1 });

    expect(await readEvents(`${bridge.controlUrl}/events`, 1)).toEqual([{ caseNo: 1 }]);
  });

  it('画面から送られた打鍵が、実行器へ渡る', async () => {
    bridge = await startLiveBridge({ source: source() });
    const got: unknown[] = [];
    bridge.onInput((input) => got.push(input));

    const res = await post(`${bridge.controlUrl}/input`, JSON.stringify({ key: 'v', caseNo: 2 }));

    expect(res.status).toBe(202);
    expect(got).toEqual([{ key: 'v', caseNo: 2 }]);
  });

  it('壊れた JSON は受け取らない（握り潰さない）', async () => {
    bridge = await startLiveBridge({ source: source() });
    const got: unknown[] = [];
    bridge.onInput((input) => got.push(input));

    const res = await post(`${bridge.controlUrl}/input`, '{ こわれている');

    expect(res.status).toBe(400);
    expect(got).toEqual([]);
  });

  it('大きすぎる本文は溜めずに弾く', async () => {
    bridge = await startLiveBridge({ source: source() });
    const res = await post(
      `${bridge.controlUrl}/input`,
      JSON.stringify({ key: 'v'.repeat(200_000) }),
    );

    expect(res.status).toBe(413);
  });

  it('token が違えば、制御チャネルも 404', async () => {
    bridge = await startLiveBridge({ source: source() });
    const wrong = `http://127.0.0.1:${String(bridge.port)}/live/00000000000000000000000000000000/control`;

    expect((await fetch(`${wrong}/events`)).status).toBe(404);
    expect((await post(`${wrong}/input`, '{}')).status).toBe(404);
  });

  it('橋を閉じると、繋がっている画面との線も切れる', async () => {
    bridge = await startLiveBridge({ source: source() });
    const res = await fetch(`${bridge.controlUrl}/events`);
    const reader = res.body!.getReader();

    await bridge.close();
    bridge = undefined;

    // 切れずに残ると、実行が終わってもプロセスが終われない。
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
    }
  });
});
