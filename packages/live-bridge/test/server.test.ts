import { afterEach, describe, expect, it } from 'vitest';

import { createAnnexBSplitter } from '@git-qa/core';

import { startLiveBridge } from '../src/index.js';
import type { LiveBridge } from '../src/index.js';

/** NAL を 1 つ。中身は見ないが、切れることに意味がある。 */
function nal(type: number, first = true): Uint8Array {
  return new Uint8Array([0, 0, 1, type & 0x1f, first ? 0x80 : 0x40, 0x11, 0x22]);
}

const source = (chunks: Uint8Array[], delayMs = 0) =>
  async function* () {
    for (const c of chunks) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      yield c;
    }
  };

async function readAll(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  expect(res.ok).toBe(true);
  return new Uint8Array(await res.arrayBuffer());
}

let bridge: LiveBridge | undefined;
afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

describe('startLiveBridge', () => {
  it('流したものが、そのまま読める', async () => {
    const chunks = [nal(7), nal(8), nal(5), nal(1)];
    bridge = await startLiveBridge({ source: source(chunks) });

    const got = await readAll(bridge.url);
    expect(got).toEqual(new Uint8Array(chunks.flatMap((c) => [...c])));
  });

  it('読み手はアクセスユニットに切れる', async () => {
    // 橋を通した後でも、切り方が変わらないこと。ここが崩れると映像が出ない。
    bridge = await startLiveBridge({ source: source([nal(7), nal(8), nal(5), nal(1)]) });

    const splitter = createAnnexBSplitter();
    const res = await fetch(bridge.url);
    const body: ReadableStream<Uint8Array> | null = res.body;
    expect(body).not.toBeNull();
    const reader = body!.getReader();
    const units = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      units.push(...splitter.push(next.value));
    }
    units.push(...splitter.flush());

    expect(units.map((u) => u.isKey)).toEqual([true, false]);
  });

  it('chunk が分かれて届いても取りこぼさない', async () => {
    // 送り元が刻んで出す場合。まとめて届く保証は無い。
    const chunks = [nal(5), nal(1), nal(1), nal(1)];
    bridge = await startLiveBridge({ source: source(chunks, 5) });

    const got = await readAll(bridge.url);
    expect(got.byteLength).toBe(chunks.reduce((n, c) => n + c.length, 0));
  });

  it('127.0.0.1 でだけ待ち受ける', async () => {
    // ここを流れるのは検証中の端末の画面。外から届く口にしない（PRD §10）。
    bridge = await startLiveBridge({ source: source([nal(5)]) });
    expect(bridge.url.startsWith('http://127.0.0.1:')).toBe(true);
  });

  it('URL に無作為の文字列が入る', async () => {
    // localhost なら安全、ではない。同じ PC の別プロセスから当てずっぽうで覗けないように。
    bridge = await startLiveBridge({ source: source([nal(5)]) });
    const other = await startLiveBridge({ source: source([nal(5)]) });
    try {
      expect(bridge.url).not.toBe(other.url);
      expect(/\/live\/[0-9a-f]{32}\.h264$/.test(new URL(bridge.url).pathname)).toBe(true);
    } finally {
      await other.close();
    }
  });

  it('別の道を叩いても、何があるかを答えない', async () => {
    bridge = await startLiveBridge({ source: source([nal(5)]) });
    const base = new URL(bridge.url).origin;

    for (const path of ['/', '/live/', '/live/00000000000000000000000000000000.h264']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('');
    }
  });

  it('送り元が落ちても、繋ぎっぱなしにせず切る', async () => {
    // 切らないと読み手が永遠に待ち、映像が止まったのか繋がっていないのか分からない。
    bridge = await startLiveBridge({
      source: () =>
        (async function* () {
          yield await Promise.resolve(nal(5));
          throw new Error('送り元が落ちた');
        })(),
    });

    const got = await readAll(bridge.url);
    expect(got).toEqual(nal(5));
  });

  it('閉じると繋がらなくなる', async () => {
    const b = await startLiveBridge({ source: source([nal(5)]) });
    const url = b.url;
    await b.close();

    await expect(fetch(url)).rejects.toThrow();
  });

  it('読み手が繋いだときに 1 回だけ流し始める', async () => {
    // 繋がる前から流すと、最初の IDR を捨てることになり、絵が出ない。
    let calls = 0;
    bridge = await startLiveBridge({
      source: () => {
        calls += 1;
        return source([nal(5)])();
      },
    });
    expect(calls).toBe(0);

    await readAll(bridge.url);
    expect(calls).toBe(1);
  });
});
