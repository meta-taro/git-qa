// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
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
 * ここで切り替えるのは `color-scheme` だけで、実際の色は OS が持っているものを使う。
 * 独自の配色を置くと、それがそのまま既成事実になる。
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
  const control = (): HTMLSelectElement =>
    root.querySelector<HTMLSelectElement>('.appearance-select')!;

  it('判定カラムの見出しに置く（3 カラムの中身を奪わない）', () => {
    installAppearanceControl(root, { store: memoryStore() });

    const heading = root.querySelector('[data-column-id="verdict"] .column-heading');
    expect(heading?.querySelector('.appearance-select')).not.toBeNull();
  });

  it('選ぶと、その場で切り替わって保存される', () => {
    const store = memoryStore();
    installAppearanceControl(root, { store });

    control().value = 'dark';
    control().dispatchEvent(new Event('change'));

    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(store.value).toBe('dark');
  });

  it('前に選んだものが、起動時に効いている', () => {
    installAppearanceControl(root, { store: memoryStore('light') });

    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(control().value).toBe('light');
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

    expect(root.querySelectorAll('.appearance-select')).toHaveLength(1);
  });
});
