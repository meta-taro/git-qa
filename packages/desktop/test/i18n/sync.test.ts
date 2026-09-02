// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import type { SettingStore } from '../../src/setting-store.js';
import {
  effectiveLocale,
  startLocaleSync,
  type LocaleBridge,
  type LocaleChoice,
} from '../../src/i18n/sync.js';

/**
 * 言語の切り替え（Issue 011）。**入口はメニュー**（`src-tauri/src/menu.rs`）。
 * OS に従うだけだと、使う人が選べない。
 */

const memoryStore = (initial?: string): SettingStore & { value: string | undefined } => {
  const store = {
    value: initial,
    getItem: () => store.value ?? null,
    setItem: (_key: string, value: string) => {
      store.value = value;
    },
  };
  return store;
};

const fakeBridge = (): LocaleBridge & {
  notified: { choice: LocaleChoice; effective: string }[];
  send: (choice: LocaleChoice) => void;
} => {
  const notified: { choice: LocaleChoice; effective: string }[] = [];
  let handler: ((choice: LocaleChoice) => void) | undefined;
  return {
    notified,
    notify: (choice, effective) => {
      notified.push({ choice, effective });
      return Promise.resolve();
    },
    subscribe: (h) => {
      handler = h;
      return Promise.resolve(() => {
        handler = undefined;
      });
    },
    send: (choice) => handler?.(choice),
  };
};

describe('effectiveLocale', () => {
  it('システムに従うなら、OS の言語で決める', () => {
    expect(effectiveLocale('system', ['en-US'])).toBe('en');
    expect(effectiveLocale('system', ['ja-JP'])).toBe('ja');
  });

  it('対応していない OS の言語なら日本語（黙って英語にしない）', () => {
    expect(effectiveLocale('system', ['fr-FR'])).toBe('ja');
  });

  it('選ばれているならそれを使う', () => {
    expect(effectiveLocale('en', ['ja-JP'])).toBe('en');
  });
});

describe('startLocaleSync', () => {
  it('覚えている言語を当て、メニュー側へも知らせる', async () => {
    const bridge = fakeBridge();
    const onChange = vi.fn();

    await startLocaleSync({
      store: memoryStore('en'),
      bridge,
      languages: ['ja-JP'],
      onChange,
    });

    expect(onChange).toHaveBeenCalledWith('en');
    // 知らせないと、メニューの文言とチェックが前回の選択とずれる。
    expect(bridge.notified).toEqual([{ choice: 'en', effective: 'en' }]);
  });

  it('システムに従うときは、実際に出す言語も一緒に知らせる', async () => {
    const bridge = fakeBridge();

    await startLocaleSync({
      store: memoryStore(),
      bridge,
      languages: ['en-GB'],
      onChange: vi.fn(),
    });

    expect(bridge.notified).toEqual([{ choice: 'system', effective: 'en' }]);
  });

  it('メニューで選ばれたら、画面へ当てて覚える', async () => {
    const store = memoryStore();
    const bridge = fakeBridge();
    const onChange = vi.fn();
    await startLocaleSync({ store, bridge, languages: ['ja-JP'], onChange });

    bridge.send('en');

    expect(onChange).toHaveBeenLastCalledWith('en');
    expect(store.value).toBe('en');
  });

  it('知らない値が来たら、システムに従うへ落とす', async () => {
    const store = memoryStore();
    const bridge = fakeBridge();
    const onChange = vi.fn();
    await startLocaleSync({ store, bridge, languages: ['ja-JP'], onChange });

    bridge.send('ねこ' as LocaleChoice);

    expect(onChange).toHaveBeenLastCalledWith('ja');
    expect(store.value).toBe('system');
  });

  it('Tauri がいなくても（ブラウザで開いても）落ちない', async () => {
    const onChange = vi.fn();

    await startLocaleSync({
      store: memoryStore('en'),
      bridge: undefined,
      languages: ['ja-JP'],
      onChange,
    });

    expect(onChange).toHaveBeenCalledWith('en');
  });
});
