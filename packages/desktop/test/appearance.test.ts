// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@git-qa/core/session';

import {
  applyAppearance,
  installAppearanceControl,
  loadAppearance,
  type AppearanceStore,
} from '../src/appearance.js';
import { renderColumns } from '../src/render.js';
import { renderSession } from '../src/session/view.js';

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

describe('installAppearanceControl', () => {
  const buttons = (): HTMLButtonElement[] => [
    ...root.querySelectorAll<HTMLButtonElement>('.appearance-option'),
  ];
  const button = (value: string): HTMLButtonElement =>
    buttons().find((b) => b.dataset['appearance'] === value)!;

  it('判定カラムの見出しに置く（3 カラムの中身を奪わない）', () => {
    installAppearanceControl(root, { store: memoryStore() });

    const heading = root.querySelector('[data-column-id="verdict"] .column-heading');
    expect(heading?.querySelector('.appearance')).not.toBeNull();
  });

  it('プルダウンではなく、押せる 3 つの選択肢として出す', () => {
    installAppearanceControl(root, { store: memoryStore() });

    expect(root.querySelector('select')).toBeNull();
    expect(buttons()).toHaveLength(3);
    expect(root.querySelector('.appearance')?.getAttribute('role')).toBe('group');
  });

  it('いま選ばれているものが、押した状態として分かる', () => {
    installAppearanceControl(root, { store: memoryStore('light') });

    expect(button('light').getAttribute('aria-pressed')).toBe('true');
    expect(button('dark').getAttribute('aria-pressed')).toBe('false');
  });

  it('押すと、その場で切り替わって保存される', () => {
    const store = memoryStore();
    installAppearanceControl(root, { store });

    button('dark').click();

    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(store.value).toBe('dark');
    expect(button('dark').getAttribute('aria-pressed')).toBe('true');
    expect(button('system').getAttribute('aria-pressed')).toBe('false');
  });

  it('ウィンドウの外観（タイトルバー）も切り替える', () => {
    // **CSS はページの中しか変えない。**枠は OS が描くので、そちらへも伝える。
    const setNativeTheme = vi.fn();
    installAppearanceControl(root, { store: memoryStore(), setNativeTheme });

    button('light').click();

    expect(setNativeTheme).toHaveBeenLastCalledWith('light');
  });

  it('前に選んだものが、起動時に効いている', () => {
    const setNativeTheme = vi.fn();
    installAppearanceControl(root, { store: memoryStore('light'), setNativeTheme });

    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(setNativeTheme).toHaveBeenCalledWith('light');
  });

  it('実行の状態を描き直しても消えない', () => {
    installAppearanceControl(root, { store: memoryStore() });
    const state: SessionState = {
      runId: 'r',
      phase: 'waiting',
      awaiting: 1,
      cases: [{ no: 1, title: 'アプリが起動する', aiResult: 'PASS' }],
    };

    renderSession(root, state);
    renderSession(root, state);

    expect(root.querySelectorAll('.appearance')).toHaveLength(1);
  });
});
