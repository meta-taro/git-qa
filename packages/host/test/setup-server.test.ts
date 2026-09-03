import { afterEach, describe, expect, it, vi } from 'vitest';

import { startSetupServer } from '../src/index.js';
import type { SetupServer } from '../src/index.js';

/**
 * アプリを入口にするための口（Issue 011 段階 3）。
 *
 * **いまの入口はターミナル。**「検証シートの読み込み方も Android の接続の仕方も分からない」
 * という指摘に対して、**アプリを開いたら選んで始められる**ようにする。
 *
 * ここは**繋ぐ前から待っている**必要がある（端末を選ぶ前に画面が要るので）。
 */

let server: SetupServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const options = (overrides: Partial<Parameters<typeof startSetupServer>[0]> = {}) => ({
  listDevices: () => Promise.resolve([{ serial: 'emulator-5554', state: 'device' }]),
  findSheets: () => Promise.resolve(['/repo/docs/a.tsv']),
  start: () =>
    Promise.resolve({
      liveUrl: 'http://127.0.0.1:1/live/a.h264',
      controlUrl: 'http://127.0.0.1:1/live/a/control',
    }),
  ...overrides,
});

const json = async (url: string): Promise<Record<string, unknown>> =>
  (await (await fetch(url)).json()) as Record<string, unknown>;

describe('startSetupServer', () => {
  it('127.0.0.1 でだけ待ち受け、URL に無作為の文字列を入れる', async () => {
    server = await startSetupServer(options());

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/setup\/[0-9a-f]{32}$/);
  });

  it('端末と検証シートの候補を返す', async () => {
    server = await startSetupServer(options());

    const state = await json(`${server.url}/state`);

    expect(state['phase']).toBe('idle');
    expect(state['devices']).toEqual([{ serial: 'emulator-5554', state: 'device' }]);
    expect(state['sheets']).toEqual(['/repo/docs/a.tsv']);
  });

  it('始めると、画面が読む URL を返す', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));

    const res = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/docs/a.tsv' }),
    });
    expect(res.status).toBe(202);

    for (let i = 0; i < 50; i += 1) {
      const state = await json(`${server.url}/state`);
      if (state['phase'] === 'running') {
        expect(state['liveUrl']).toBe('http://127.0.0.1:9/live/x.h264');
        expect(start).toHaveBeenCalledWith({
          serial: 'emulator-5554',
          sheetPath: '/repo/docs/a.tsv',
        });
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('running にならなかった');
  });

  it('始められなかったら、理由を state に残す（黙って idle に戻さない）', async () => {
    server = await startSetupServer(
      options({ start: () => Promise.reject(new Error('端末が見つからない')) }),
    );

    await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'x', sheetPath: '/a.tsv' }),
    });

    for (let i = 0; i < 50; i += 1) {
      const state = await json(`${server.url}/state`);
      if (state['phase'] === 'failed') {
        expect(state['error']).toContain('端末が見つからない');
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('failed にならなかった');
  });

  it('二重に始めない（走っている最中の start は断る）', async () => {
    server = await startSetupServer(options());

    const send = () =>
      fetch(`${server!.url}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/docs/a.tsv' }),
      });

    expect((await send()).status).toBe(202);
    const second = await send();
    expect(second.status).toBe(409);
  });

  it('端末やシートの指定が無い start は受け取らない', async () => {
    server = await startSetupServer(options());

    const res = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554' }),
    });

    expect(res.status).toBe(400);
  });

  it('token が違えば 404', async () => {
    server = await startSetupServer(options());
    const wrong = `http://127.0.0.1:${String(server.port)}/setup/${'0'.repeat(32)}/state`;

    expect((await fetch(wrong)).status).toBe(404);
  });

  it('画面のオリジンからの読み取りを許す（別オリジンなので）', async () => {
    server = await startSetupServer(options());

    const res = await fetch(`${server.url}/state`, {
      headers: { origin: 'http://localhost:1420' },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:1420');
  });
});

describe('置いた人（ハンドル）', () => {
  /**
   * **`unknown` のまま証跡に残ると、「誰が保証したか」が読めない。**
   * この製品の芯なので、始めるときに受け取る。
   */
  it('ハンドルを受け取って実行へ渡す', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));

    await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serial: 'emulator-5554',
        sheetPath: '/repo/a.tsv',
        operator: 'octocat',
      }),
    });

    for (let i = 0; i < 50; i += 1) {
      if (start.mock.calls.length > 0) {
        expect(start).toHaveBeenCalledWith({
          serial: 'emulator-5554',
          sheetPath: '/repo/a.tsv',
          operator: 'octocat',
        });
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('start が呼ばれなかった');
  });

  it('ハンドルが無くても始められる（環境変数で渡す道を残す）', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));

    const res = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/a.tsv' }),
    });

    expect(res.status).toBe(202);
  });

  it('個人名を書かせない形にする（長すぎるものは受け取らない）', async () => {
    server = await startSetupServer(options());

    const res = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serial: 'emulator-5554',
        sheetPath: '/repo/a.tsv',
        operator: 'a'.repeat(100),
      }),
    });

    expect(res.status).toBe(400);
  });
});
