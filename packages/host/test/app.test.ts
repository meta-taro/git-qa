import { describe, expect, it, vi } from 'vitest';

import { runWithLiveView, tauriDevArgs } from '../src/index.js';
import { stubAdapter } from './stub-adapter.js';

describe('tauriDevArgs', () => {
  it('画面が読む URL を、devUrl のクエリに載せる', () => {
    // Tauri は devUrl を開く。ここに載せる以外に、起動時の値を webview へ渡す手が無い。
    const args = tauriDevArgs('http://127.0.0.1:9000/live/abc.h264');
    const config: unknown = JSON.parse(args[args.indexOf('--config') + 1] ?? '');

    expect(args.slice(0, 2)).toEqual(['dev', '--config']);
    expect(config).toMatchObject({
      build: { devUrl: expect.stringContaining('http://localhost:1420/?live=') as unknown },
    });
  });

  it('URL をそのまま埋めず、クエリとして安全な形にする', () => {
    // 橋の URL には : / が入る。生で埋めるとクエリが壊れる。
    const live = 'http://127.0.0.1:9000/live/abc.h264';
    const args = tauriDevArgs(live);
    const config = JSON.parse(args[args.indexOf('--config') + 1] ?? '') as {
      build: { devUrl: string };
    };

    const parsed = new URL(config.build.devUrl);
    expect(parsed.searchParams.get('live')).toBe(live);
  });

  it('devUrl を差し替えられる', () => {
    const args = tauriDevArgs('http://127.0.0.1:1/live/a.h264', 'http://localhost:5173');
    const config = JSON.parse(args[args.indexOf('--config') + 1] ?? '') as {
      build: { devUrl: string };
    };

    expect(config.build.devUrl.startsWith('http://localhost:5173/?live=')).toBe(true);
  });

  it('JSON として読める形で渡す', () => {
    // 壊れた JSON を渡すと tauri が黙って既定値で起動し、映像の無い画面が出る。
    const args = tauriDevArgs('http://127.0.0.1:1/live/a.h264');
    const raw = args[args.indexOf('--config') + 1] ?? '';
    expect(() => {
      JSON.parse(raw);
    }).not.toThrow();
  });
});

describe('runWithLiveView', () => {
  it('画面へ、橋の URL を渡す', async () => {
    const adapter = stubAdapter({});
    const launch = vi.fn().mockResolvedValue(undefined);

    await runWithLiveView({ adapter, launch });

    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0]?.[0]).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/live\/[0-9a-f]{32}\.h264$/,
    );
  });

  it('画面を起こす時点で、その URL から映像が読める', async () => {
    // 順番を間違えて先に画面を起こすと、繋がらない URL を渡すことになる。
    const adapter = stubAdapter({});
    let readable = false;

    await runWithLiveView({
      adapter,
      launch: async (url) => {
        readable = (await fetch(url)).ok;
      },
    });

    expect(readable).toBe(true);
  });

  it('画面が閉じたら、ライブビューとセッションを閉じる', async () => {
    // 人が窓を閉じたのに端末を掴んだままにしない。
    const adapter = stubAdapter({});

    await runWithLiveView({ adapter, launch: () => Promise.resolve() });

    expect(adapter.closed).toEqual(['liveView', 'session']);
  });

  it('画面が落ちても、閉じてから投げる', async () => {
    const adapter = stubAdapter({});

    await expect(
      runWithLiveView({ adapter, launch: () => Promise.reject(new Error('画面が落ちた')) }),
    ).rejects.toThrow(/画面が落ちた/);

    expect(adapter.closed).toEqual(['liveView', 'session']);
  });

  it('端末に繋げなければ、画面を起こさない', async () => {
    // 映らない画面を出すと、繋がっていないのか映らないのかが人に分からない。
    const adapter = stubAdapter({ mode: 'external-window' });
    const launch = vi.fn().mockResolvedValue(undefined);

    await expect(runWithLiveView({ adapter, launch })).rejects.toThrow(/映像を読む口/);
    expect(launch).not.toHaveBeenCalled();
  });
});
