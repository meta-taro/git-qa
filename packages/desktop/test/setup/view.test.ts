// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderColumns } from '../../src/render.js';
import { renderSetup } from '../../src/setup/view.js';
import type { SetupState } from '../../src/setup/client.js';

/**
 * アプリを開いた人が、**ターミナルを見ずに端末とシートを選んで始められる**画面（Issue 011 段階 3）。
 */

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  renderColumns(root);
});

const live = (): HTMLElement => root.querySelector<HTMLElement>('[data-column-id="live"]')!;

const idle: SetupState = {
  phase: 'idle',
  devices: [
    { serial: 'emulator-5554', state: 'device' },
    { serial: 'R5CT1234', state: 'device' },
  ],
  sheets: ['/repo/docs/a.tsv', '/repo/docs/b.tsv'],
};

describe('renderSetup', () => {
  it('見えている端末を選べる', () => {
    renderSetup(root, idle, { onStart: vi.fn() });

    const devices = live().querySelectorAll('.setup-device');
    expect(devices).toHaveLength(2);
    expect(devices[0]?.textContent).toContain('emulator-5554');
  });

  it('検証シートを選べる', () => {
    renderSetup(root, idle, { onStart: vi.fn() });

    expect(live().querySelectorAll('.setup-sheet')).toHaveLength(2);
  });

  it('選んで押すと、その組で始める', () => {
    const onStart = vi.fn();
    renderSetup(root, idle, { onStart });

    live().querySelector<HTMLElement>('.setup-device[data-serial="R5CT1234"]')?.click();
    live().querySelector<HTMLElement>('.setup-sheet[data-path="/repo/docs/b.tsv"]')?.click();
    live().querySelector<HTMLButtonElement>('.setup-start')?.click();

    expect(onStart).toHaveBeenCalledWith({ serial: 'R5CT1234', sheetPath: '/repo/docs/b.tsv' });
  });

  it('端末が見えていなければ、始められない（繋いでくださいと出す）', () => {
    renderSetup(root, { ...idle, devices: [] }, { onStart: vi.fn() });

    expect(live().querySelector<HTMLButtonElement>('.setup-start')?.disabled).toBe(true);
    expect(live().textContent).toContain('繋');
  });

  it('シートが見つからなければ、始められない', () => {
    renderSetup(root, { ...idle, sheets: [] }, { onStart: vi.fn() });

    expect(live().querySelector<HTMLButtonElement>('.setup-start')?.disabled).toBe(true);
  });

  it('始めている最中は、押せない', () => {
    renderSetup(root, { ...idle, phase: 'starting' }, { onStart: vi.fn() });

    expect(live().querySelector<HTMLButtonElement>('.setup-start')?.disabled).toBe(true);
  });

  it('始められなかった理由を出す（黙って戻さない）', () => {
    renderSetup(
      root,
      { ...idle, phase: 'failed', error: '端末が見つからない' },
      { onStart: vi.fn() },
    );

    expect(live().textContent).toContain('端末が見つからない');
  });

  it('描き直しても増えない', () => {
    renderSetup(root, idle, { onStart: vi.fn() });
    renderSetup(root, idle, { onStart: vi.fn() });

    expect(live().querySelectorAll('.setup-device')).toHaveLength(2);
  });

  it('左右のカラムには触らない', () => {
    const cases = root.querySelector<HTMLElement>('[data-column-id="cases"]')!;
    const before = cases.innerHTML;

    renderSetup(root, idle, { onStart: vi.fn() });

    expect(cases.innerHTML).toBe(before);
  });
});

describe('検証シートを自分で選ぶ（Issue 011 段階 3 の続き）', () => {
  /**
   * **配布物では作業ディレクトリが `/` になる**ので、探して並べるだけでは足りない
   * （実機で「検証シートが無い」と出た）。人が自分で選べる道を用意する。
   */
  it('選ぶボタンが出る', () => {
    renderSetup(root, idle, { onStart: vi.fn(), onPickSheet: vi.fn() });

    expect(live().querySelector('.setup-pick')).not.toBeNull();
  });

  it('押すと、選ぶ口が呼ばれる', () => {
    const onPickSheet = vi.fn();
    renderSetup(root, idle, { onStart: vi.fn(), onPickSheet });

    live().querySelector<HTMLButtonElement>('.setup-pick')?.click();

    expect(onPickSheet).toHaveBeenCalledOnce();
  });

  it('シートが 1 つも見つからなくても、選ぶボタンは出る', () => {
    renderSetup(root, { ...idle, sheets: [] }, { onStart: vi.fn(), onPickSheet: vi.fn() });

    expect(live().querySelector('.setup-pick')).not.toBeNull();
  });

  it('選んだシートが一覧に無くても、それで始められる', () => {
    const onStart = vi.fn();
    renderSetup(root, idle, { onStart, onPickSheet: vi.fn(), pickedSheet: '/どこか/別の.tsv' });

    live().querySelector<HTMLButtonElement>('.setup-start')?.click();

    expect(onStart).toHaveBeenCalledWith({
      serial: 'emulator-5554',
      sheetPath: '/どこか/別の.tsv',
    });
  });
});
