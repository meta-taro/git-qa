// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAppearance,
  loadAppearance,
  startAppearanceSync,
  type Appearance,
  type AppearanceBridge,
  type AppearanceStore,
} from '../src/appearance.js';
import { renderColumns } from '../src/render.js';

/**
 * ライト / ダークの切り替え。
 *
 * **色は決めない**（`DESIGN.md` が空・product-baseline §11）。
 * ここで切り替えるのは `color-scheme` と**ウィンドウの外観**だけで、
 * 実際の色は OS が持っているものを使う。独自の配色を置くと、それが既成事実になる。
 */

const memoryStore = (initial?: string): AppearanceStore & { value: string | undefined } => {
  const store = {
    value: initial,
    getItem: () => store.value ?? null,
    setItem: (_key: string, value: string) => {
      store.value = value;
    },
  };
  return store;
};

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.colorScheme = '';
  root = document.createElement('div');
  document.body.append(root);
  renderColumns(root);
});

describe('applyAppearance', () => {
  it('システムに従うなら、OS の設定に任せる', () => {
    applyAppearance(document, 'system');

    expect(document.documentElement.style.colorScheme).toBe('light dark');
  });

  it('ライト / ダークを選べる', () => {
    applyAppearance(document, 'light');
    expect(document.documentElement.style.colorScheme).toBe('light');

    applyAppearance(document, 'dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});

describe('loadAppearance', () => {
  it('前に選んだものを覚えている', () => {
    expect(loadAppearance(memoryStore('dark'))).toBe('dark');
  });

  it('何も無ければ、システムに従う', () => {
    expect(loadAppearance(memoryStore())).toBe('system');
  });

  it('知らない値が入っていたら、システムに従う', () => {
    expect(loadAppearance(memoryStore('ねこ'))).toBe('system');
  });

  it('保存の口が使えない環境でも落ちない', () => {
    const broken: AppearanceStore = {
      getItem: () => {
        throw new Error('保存が使えない');
      },
      setItem: () => {
        throw new Error('保存が使えない');
      },
    };

    expect(loadAppearance(broken)).toBe('system');
  });
});

describe('startAppearanceSync — メニューと画面をつなぐ', () => {
  const fakeBridge = (): AppearanceBridge & {
    notified: Appearance[];
    send: (value: Appearance) => void;
  } => {
    const notified: Appearance[] = [];
    let handler: ((value: Appearance) => void) | undefined;
    return {
      notified,
      notify: (value) => {
        notified.push(value);
        return Promise.resolve();
      },
      subscribe: (h) => {
        handler = h;
        return Promise.resolve(() => {
          handler = undefined;
        });
      },
      send: (value) => handler?.(value),
    };
  };

  it('覚えている外観を当て、メニュー側へも知らせる', async () => {
    // 知らせないと、メニューのチェックと枠が前回の選択とずれる。
    const bridge = fakeBridge();

    await startAppearanceSync({ store: memoryStore('dark'), bridge });

    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(bridge.notified).toEqual(['dark']);
  });

  it('メニューで選ばれたら、画面へ当てて覚える', async () => {
    const store = memoryStore();
    const bridge = fakeBridge();
    await startAppearanceSync({ store, bridge });

    bridge.send('light');

    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(store.value).toBe('light');
  });

  it('Tauri がいなくても（ブラウザで開いても）落ちない', async () => {
    await startAppearanceSync({ store: memoryStore('dark'), bridge: undefined });

    // 画面の中は切り替わる。枠は Tauri のものなので、そこだけ変わらない。
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('画面に設定の部品を置かない（3 カラムは検証のための場所）', async () => {
    await startAppearanceSync({ store: memoryStore(), bridge: fakeBridge() });

    expect(root.querySelector('select')).toBeNull();
    expect(root.querySelector('.appearance')).toBeNull();
  });
});
