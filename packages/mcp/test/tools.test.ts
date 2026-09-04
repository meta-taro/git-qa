import { describe, expect, it, vi } from 'vitest';

import type { Action, TargetSession } from '@git-qa/core';

import { createDeviceTools } from '../src/tools.js';

/**
 * MCP から端末を触るための道具。
 *
 * **判定を置く道具は無い。**`VERIFIED` を AI が置けるようにした瞬間、この製品の芯
 * （人が見て保証したことが証跡に残る・C1 / C17）が壊れる。
 * AI にやらせるのは端末の操作と画面の取得まで。
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function stubSession(): TargetSession & { actions: Action[]; closed: boolean } {
  const actions: Action[] = [];
  const session = {
    actions,
    closed: false,
    target: { kind: 'android' as const, device: 'Stub', osVersion: '12', build: {} },
    liveView: {
      isOpen: false,
      transport: { kind: 'external-window' as const, label: 'stub' },
      open: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
    recording: {
      requested: false,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve({ state: 'not_requested' as const }),
    },
    isClosed: false,
    act: (action: Action) => {
      actions.push(action);
      return Promise.resolve();
    },
    observe: () =>
      Promise.resolve({
        kind: 'android' as const,
        capturedAt: '2026-09-02T00:00:00.000Z',
        raw: '<node text="保存" content-desc="" />',
      }),
    screenshot: () =>
      Promise.resolve({
        format: 'png' as const,
        bytes: PNG,
        capturedAt: '2026-09-02T00:00:00.000Z',
      }),
    screenSize: () => Promise.resolve({ width: 1080, height: 2220 }),
    close() {
      session.closed = true;
      return Promise.resolve();
    },
  };
  return session;
}

describe('createDeviceTools', () => {
  it('タップを端末へ送る', async () => {
    const session = stubSession();
    const tools = createDeviceTools({ connect: () => Promise.resolve(session) });

    await tools.tap(540, 1200);

    expect(session.actions).toEqual([{ kind: 'tap', target: { at: 'point', x: 540, y: 1200 } }]);
  });

  it('フリックを端末へ送る', async () => {
    const session = stubSession();
    const tools = createDeviceTools({ connect: () => Promise.resolve(session) });

    await tools.swipe({ x: 540, y: 2000 }, { x: 540, y: 400 }, 120);

    expect(session.actions).toEqual([
      {
        kind: 'swipe',
        from: { at: 'point', x: 540, y: 2000 },
        to: { at: 'point', x: 540, y: 400 },
        durationMs: 120,
      },
    ]);
  });

  it('キー（HOME / BACK 等）を送る', async () => {
    const session = stubSession();
    const tools = createDeviceTools({ connect: () => Promise.resolve(session) });

    await tools.key('HOME');

    expect(session.actions).toEqual([{ kind: 'key', key: 'HOME' }]);
  });

  it('画面を PNG で取る', async () => {
    const session = stubSession();
    const tools = createDeviceTools({ connect: () => Promise.resolve(session) });

    const shot = await tools.screenshot();

    expect(shot.mimeType).toBe('image/png');
    expect(shot.base64).toBe(Buffer.from(PNG).toString('base64'));
  });

  it('画面で読める文字を取る', async () => {
    const session = stubSession();
    const tools = createDeviceTools({ connect: () => Promise.resolve(session) });

    await expect(tools.screenText()).resolves.toContain('保存');
  });

  it('端末の実寸を取る（座標を決めるのに要る）', async () => {
    const session = stubSession();
    const tools = createDeviceTools({ connect: () => Promise.resolve(session) });

    await expect(tools.screenSize()).resolves.toEqual({ width: 1080, height: 2220 });
  });

  it('繋ぎ直さない（毎回繋ぐと遅く、端末も掴み合う）', async () => {
    const session = stubSession();
    const connect = vi.fn().mockResolvedValue(session);
    const tools = createDeviceTools({ connect });

    await tools.tap(1, 1);
    await tools.tap(2, 2);

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('閉じると端末を離す', async () => {
    const session = stubSession();
    const tools = createDeviceTools({ connect: () => Promise.resolve(session) });

    await tools.tap(1, 1);
    await tools.close();

    expect(session.closed).toBe(true);
  });

  it('判定を置く道具は持たない（人だけが置く）', () => {
    const tools = createDeviceTools({ connect: () => Promise.resolve(stubSession()) });

    expect(Object.keys(tools)).not.toContain('verdict');
    expect(Object.keys(tools)).not.toContain('verify');
  });
});

/**
 * **語彙に入れたものは、道具にも要る。**
 *
 * 検証シートは「アプリを起動する」から始まる（C40）。それを AI が代わりに動かせるのに、
 * 端末を触る道具の側に起動が無いと、**MCP から動かすときだけ 1 件目で止まる。**
 * 文字入力も同じ理由で足す（`device_key` では 1 文字ずつしか送れない）。
 */
describe('起動と入力', () => {
  it('アプリを起動する', async () => {
    const session = stubSession();
    const tools = createDeviceTools({ connect: () => Promise.resolve(session) });

    await tools.launch('com.android.settings');

    expect(session.actions).toEqual([{ kind: 'launch', app: 'com.android.settings' }]);
  });

  it('文字を送る', async () => {
    const session = stubSession();
    const tools = createDeviceTools({ connect: () => Promise.resolve(session) });

    await tools.type('battery');

    expect(session.actions).toEqual([{ kind: 'type', text: 'battery' }]);
  });
});
