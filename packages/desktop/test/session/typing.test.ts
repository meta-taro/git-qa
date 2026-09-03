// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderColumns } from '../../src/render.js';
import { installTextSender } from '../../src/session/typing.js';

/**
 * 端末へ文字を送る欄（Issue 013 の続き）。
 *
 * **端末の入力は IME を通らない。**日本語は送れないので、そう言う。
 */

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  renderColumns(root);
});

const field = (): HTMLInputElement => root.querySelector<HTMLInputElement>('.typing-input')!;
const send = (): HTMLButtonElement => root.querySelector<HTMLButtonElement>('.typing-send')!;

describe('installTextSender', () => {
  it('中央のカラムに入力欄が出る', () => {
    installTextSender(root, { onSend: vi.fn(), onError: vi.fn() });

    expect(field()).not.toBeNull();
    expect(send()).not.toBeNull();
  });

  it('打った文字を送る', () => {
    const onSend = vi.fn();
    installTextSender(root, { onSend, onError: vi.fn() });

    field().value = 'hello';
    send().click();

    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('送った後は欄を空にする（同じ文字を二度送らない）', () => {
    installTextSender(root, { onSend: vi.fn(), onError: vi.fn() });

    field().value = 'hello';
    send().click();

    expect(field().value).toBe('');
  });

  it('**日本語は送らない。**送れない理由を出す', () => {
    const onSend = vi.fn();
    const onError = vi.fn();
    installTextSender(root, { onSend, onError });

    field().value = 'あいうえお';
    send().click();

    expect(onSend).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    // 欄は空にしない。**打ち直せるように残す。**
    expect(field().value).toBe('あいうえお');
  });

  it('空のまま押しても何もしない', () => {
    const onSend = vi.fn();
    installTextSender(root, { onSend, onError: vi.fn() });

    send().click();

    expect(onSend).not.toHaveBeenCalled();
  });

  it('2 回置いても増えない', () => {
    installTextSender(root, { onSend: vi.fn(), onError: vi.fn() });
    installTextSender(root, { onSend: vi.fn(), onError: vi.fn() });

    expect(root.querySelectorAll('.typing-input')).toHaveLength(1);
  });
});
