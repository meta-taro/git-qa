// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { isTypingHandle, nextDrawing } from '../../src/setup/redraw.js';
import type { SetupState } from '../../src/setup/client.js';

/**
 * **打っている最中に描き直すと、入力欄が作り直されてフォーカスが飛ぶ。**
 *
 * 2026-09-04、人がハンドルを打ち直していて「me まで打つとなぜかフォーカスが外れます」。
 * 描き直しの条件に `operator === ''` が入っていたため、空 → 1 文字目で条件が反転し、
 * 次の poll（1 秒）で画面ごと作り直されていた。
 */
const idle: SetupState = {
  phase: 'idle',
  devices: [{ serial: 'emulator-5554', state: 'device' }],
  sheets: ['/repo/a.tsv'],
};

describe('nextDrawing', () => {
  it('変わっていなければ描き直さない', () => {
    const first = nextDrawing(idle, undefined, '', false);
    expect(first).toBeDefined();
    expect(nextDrawing(idle, undefined, first!, false)).toBeUndefined();
  });

  it('端末が増えたら描き直す', () => {
    const first = nextDrawing(idle, undefined, '', false)!;
    const more = { ...idle, devices: [...idle.devices, { serial: 'R5CT1234', state: 'device' }] };

    expect(nextDrawing(more, undefined, first, false)).toBeDefined();
  });

  it('自分で選んだシートが変わったら描き直す', () => {
    const first = nextDrawing(idle, undefined, '', false)!;

    expect(nextDrawing(idle, '/elsewhere/b.tsv', first, false)).toBeDefined();
  });

  it('ハンドルを打っている最中は、端末が増えても描き直さない', () => {
    // **入力欄を作り直さない。**打っている手を止めるほうが、1 秒古い一覧より高くつく。
    const first = nextDrawing(idle, undefined, '', false)!;
    const more = { ...idle, devices: [...idle.devices, { serial: 'R5CT1234', state: 'device' }] };

    expect(nextDrawing(more, undefined, first, true)).toBeUndefined();
  });

  it('打ち終われば、溜まっていた変化を描き直す', () => {
    const first = nextDrawing(idle, undefined, '', false)!;
    const more = { ...idle, devices: [...idle.devices, { serial: 'R5CT1234', state: 'device' }] };
    nextDrawing(more, undefined, first, true);

    expect(nextDrawing(more, undefined, first, false)).toBeDefined();
  });
});

describe('isTypingHandle', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('ハンドルの欄にいるあいだは true', () => {
    const input = document.createElement('input');
    input.className = 'setup-operator';
    document.body.append(input);
    input.focus();

    expect(isTypingHandle(document)).toBe(true);
  });

  it('別の所にいるなら false', () => {
    const other = document.createElement('input');
    document.body.append(other);
    other.focus();

    expect(isTypingHandle(document)).toBe(false);
  });

  it('どこにもいないなら false', () => {
    expect(isTypingHandle(document)).toBe(false);
  });
});
