import { describe, expect, it, vi } from 'vitest';

import {
  fetchSetupState,
  requestStart,
  resolveSetupUrl,
  setupUrlFromLocation,
} from '../../src/setup/client.js';

/**
 * 入口サーバ（`@git-qa/host`）との線。**アプリを開いたら選んで始められる**ようにする側。
 */

describe('setupUrlFromLocation', () => {
  it('?setup= から読む', () => {
    expect(setupUrlFromLocation('?setup=http://127.0.0.1:5/setup/abc')).toBe(
      'http://127.0.0.1:5/setup/abc',
    );
  });

  it('localhost 以外・http 以外は受け取らない（映像や制御と同じ規則）', () => {
    expect(setupUrlFromLocation('?setup=https://example.com/setup')).toBeUndefined();
    expect(setupUrlFromLocation('')).toBeUndefined();
  });
});

describe('fetchSetupState', () => {
  it('端末とシートの候補を読む', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          phase: 'idle',
          devices: [{ serial: 'emulator-5554', state: 'device' }],
          sheets: ['/repo/a.tsv'],
        }),
        { status: 200 },
      ),
    );

    const state = await fetchSetupState('http://127.0.0.1:5/setup/abc', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:5/setup/abc/state');
    expect(state?.devices[0]?.serial).toBe('emulator-5554');
  });

  it('形が違えば受け取らない（黙って空の画面を出さない）', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"phase":"ねている"}', { status: 200 }));

    await expect(
      fetchSetupState('http://127.0.0.1:5/setup/abc', fetchImpl),
    ).resolves.toBeUndefined();
  });

  it('繋がらなければ undefined（落とさない）', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('繋がらない'));

    await expect(
      fetchSetupState('http://127.0.0.1:5/setup/abc', fetchImpl),
    ).resolves.toBeUndefined();
  });
});

describe('requestStart', () => {
  it('選んだ端末とシートを送る', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    await requestStart(
      'http://127.0.0.1:5/setup/abc',
      { serial: 'emulator-5554', sheetPath: '/repo/a.tsv' },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:5/setup/abc/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/a.tsv' }),
    });
  });

  it('断られたら落とす（押したのに始まっていない状態を黙らせない）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 409 }));

    await expect(
      requestStart('http://127.0.0.1:5/setup/abc', { serial: 'a', sheetPath: 'b' }, fetchImpl),
    ).rejects.toThrow(/409/);
  });
});

describe('resolveSetupUrl — 配布物では URL をアプリに聞く', () => {
  /**
   * **配布物ではクエリで渡せない。**開発中（`pnpm app`）は `?setup=` が付くが、
   * `.app` を叩いたときは付かないので、Node 側を起こしたアプリに聞く。
   */
  it('クエリにあればそれを使う（アプリに聞きに行かない）', async () => {
    const ask = vi.fn();

    await expect(
      resolveSetupUrl('?setup=http://127.0.0.1:5/setup/abc', { ask, waitMs: 0, tries: 1 }),
    ).resolves.toBe('http://127.0.0.1:5/setup/abc');
    expect(ask).not.toHaveBeenCalled();
  });

  it('クエリに無ければアプリに聞く', async () => {
    const ask = vi.fn().mockResolvedValue('http://127.0.0.1:9/setup/xyz');

    await expect(resolveSetupUrl('', { ask, waitMs: 0, tries: 3 })).resolves.toBe(
      'http://127.0.0.1:9/setup/xyz',
    );
  });

  it('まだ起きていなければ、起きるまで聞き直す', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue('http://127.0.0.1:9/setup/xyz');

    await expect(resolveSetupUrl('', { ask, waitMs: 0, tries: 5 })).resolves.toBe(
      'http://127.0.0.1:9/setup/xyz',
    );
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('起こせなかった理由は、そのまま投げる（黙って空の画面を出さない）', async () => {
    const ask = vi.fn().mockRejectedValue(new Error('Node を起こせない（node が要る）'));

    await expect(resolveSetupUrl('', { ask, waitMs: 0, tries: 3 })).rejects.toThrow(/node が要る/);
  });

  it('いつまでも起きなければ undefined（画面は案内を出す）', async () => {
    const ask = vi.fn().mockResolvedValue(null);

    await expect(resolveSetupUrl('', { ask, waitMs: 0, tries: 2 })).resolves.toBeUndefined();
  });
});
