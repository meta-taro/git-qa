import { describe, expect, it } from 'vitest';

import { readSetting, writeSetting, type SettingStore } from '../src/setting-store.js';

/**
 * 設定を覚えておく口。**使えなくても落ちない**ことが要点。
 * webview では localStorage が切られていることがある。
 */

const memory = (initial?: string): SettingStore & { value: string | undefined } => {
  const store = {
    value: initial,
    getItem: () => store.value ?? null,
    setItem: (_key: string, value: string) => {
      store.value = value;
    },
  };
  return store;
};

const broken: SettingStore = {
  getItem: () => {
    throw new Error('保存が使えない');
  },
  setItem: () => {
    throw new Error('保存が使えない');
  },
};

describe('readSetting', () => {
  it('入っている値を返す', () => {
    expect(readSetting('k', memory('dark'))).toBe('dark');
  });

  it('無ければ undefined', () => {
    expect(readSetting('k', memory())).toBeUndefined();
  });

  it('口そのものが無くても落ちない', () => {
    expect(readSetting('k', undefined)).toBeUndefined();
  });

  it('読めない環境でも落ちない', () => {
    expect(readSetting('k', broken)).toBeUndefined();
  });
});

describe('writeSetting', () => {
  it('覚える', () => {
    const store = memory();
    writeSetting('k', 'light', store);

    expect(store.value).toBe('light');
  });

  it('**覚えられなくても落ちない**（いまの切り替えは効いている）', () => {
    expect(() => writeSetting('k', 'light', broken)).not.toThrow();
    expect(() => writeSetting('k', 'light', undefined)).not.toThrow();
  });
});
