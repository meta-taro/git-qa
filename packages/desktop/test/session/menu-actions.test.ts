import { describe, expect, it, vi } from 'vitest';

import { startMenuActions, type OpenSheetBridge } from '../../src/session/menu-actions.js';

/**
 * メニューから検証シートを開く（Issue 011）。
 *
 * **画面から見えているのは端末の映像だけ。**いま何を走らせているのかを、
 * 人がファイルとして確かめる道が要る。
 */

const fakeBridge = (
  fail?: string,
): OpenSheetBridge & { opened: { path: string; mode: string }[]; send: (a: string) => void } => {
  const opened: { path: string; mode: string }[] = [];
  let handler: ((action: string) => void) | undefined;
  return {
    opened,
    open: (path, mode) => {
      opened.push({ path, mode });
      return fail === undefined ? Promise.resolve() : Promise.reject(new Error(fail));
    },
    subscribe: (h) => {
      handler = h;
      return Promise.resolve(() => {
        handler = undefined;
      });
    },
    send: (action) => handler?.(action),
  };
};

describe('startMenuActions', () => {
  it('メニューの項目ごとに、開き方を選ぶ', async () => {
    const bridge = fakeBridge();
    await startMenuActions({
      bridge,
      sheetPath: () => '/repo/docs/a.tsv',
      onError: vi.fn(),
    });

    bridge.send('file:md-business');
    bridge.send('file:reveal');
    bridge.send('file:open');
    await Promise.resolve();

    expect(bridge.opened).toEqual([
      { path: '/repo/docs/a.tsv', mode: 'md-business' },
      { path: '/repo/docs/a.tsv', mode: 'reveal' },
      { path: '/repo/docs/a.tsv', mode: 'default' },
    ]);
  });

  it('走らせているシートが無ければ、そう言う（黙って何も起きないようにしない）', async () => {
    const bridge = fakeBridge();
    const onError = vi.fn();
    await startMenuActions({ bridge, sheetPath: () => undefined, onError });

    bridge.send('file:open');

    expect(bridge.opened).toEqual([]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('開けなかったら理由を出す（アプリが入っていない等）', async () => {
    const bridge = fakeBridge('md-business が見つからない');
    const onError = vi.fn();
    await startMenuActions({ bridge, sheetPath: () => '/repo/a.tsv', onError });

    bridge.send('file:md-business');
    await new Promise((r) => setTimeout(r, 0));

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('md-business が見つからない'));
  });

  it('知らないメニューの項目は無視する', async () => {
    const bridge = fakeBridge();
    const onError = vi.fn();
    await startMenuActions({ bridge, sheetPath: () => '/repo/a.tsv', onError });

    bridge.send('file:なにか');

    expect(bridge.opened).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });
});
