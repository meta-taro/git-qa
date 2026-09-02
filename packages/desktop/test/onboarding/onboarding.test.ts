// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { renderColumns } from '../../src/render.js';
import { connectionStatus, renderOnboarding } from '../../src/onboarding/index.js';

/**
 * **アプリを開いた人が、次に何をすればよいか分かること**（Issue 011）。
 *
 * いまの入口はターミナルなので、アプリを開いただけでは何も起きない。
 * 空の枠を出して黙るのが一番まずい。
 */

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  renderColumns(root);
});

const live = (): HTMLElement => root.querySelector<HTMLElement>('[data-column-id="live"]')!;

describe('connectionStatus — いまどこまで繋がっているか', () => {
  it('何も渡されていなければ、まだ繋がっていない', () => {
    expect(connectionStatus({})).toBe('disconnected');
  });

  it('映像だけなら、端末には繋がっている（pnpm live の状態）', () => {
    expect(connectionStatus({ liveUrl: 'http://127.0.0.1:1/live/a.h264' })).toBe('device-only');
  });

  it('映像と制御の両方があれば、実行中', () => {
    expect(
      connectionStatus({
        liveUrl: 'http://127.0.0.1:1/live/a.h264',
        controlUrl: 'http://127.0.0.1:1/live/a/control',
      }),
    ).toBe('running');
  });
});

describe('renderOnboarding', () => {
  it('未接続なら、中央に手順が出る', () => {
    renderOnboarding(root, 'disconnected');

    const steps = live().querySelectorAll('.onboarding-step');
    expect(steps.length).toBeGreaterThanOrEqual(3);
  });

  it('いまやることが 1 つだけ印される', () => {
    renderOnboarding(root, 'disconnected');

    const current = live().querySelectorAll('.onboarding-step[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain('adb devices');
  });

  it('端末に繋がっていれば、いまやることが次へ進む', () => {
    renderOnboarding(root, 'device-only');

    const current = live().querySelector('.onboarding-step[aria-current="step"]');
    expect(current?.textContent).toContain('run:sheet');
  });

  it('打つコマンドは、選んでコピーできる形で出す', () => {
    renderOnboarding(root, 'disconnected');

    const commands = [...live().querySelectorAll('code.onboarding-command')];
    expect(commands.length).toBeGreaterThanOrEqual(2);
    expect(commands.map((c) => c.textContent)).toContain('adb devices');
  });

  it('実行中なら案内を出さない（映像の邪魔をしない）', () => {
    renderOnboarding(root, 'disconnected');
    renderOnboarding(root, 'running');

    expect(live().querySelectorAll('.onboarding-step')).toHaveLength(0);
  });

  it('2 回描いても増えない', () => {
    renderOnboarding(root, 'disconnected');
    const before = live().querySelectorAll('.onboarding-step').length;

    renderOnboarding(root, 'disconnected');

    expect(live().querySelectorAll('.onboarding-step')).toHaveLength(before);
  });

  it('左右のカラムには触らない', () => {
    const cases = root.querySelector<HTMLElement>('[data-column-id="cases"]')!;
    const before = cases.innerHTML;

    renderOnboarding(root, 'disconnected');

    expect(cases.innerHTML).toBe(before);
  });
});
