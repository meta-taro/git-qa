// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { MESSAGES } from '../../src/i18n/index.js';
import { renderColumns } from '../../src/render.js';
import { showDesktopNote } from '../../src/live/view.js';

/**
 * **2026-09-07、人の判断。**
 *
 * > デスクトップアプリの時だけ最悪補助ボタンとかでいいです。注意書きで、
 * > もしくは実物を操作してくださいみたいな
 *
 * **できないことを、できるふりで隠さない。**
 */
describe('showDesktopNote', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
  });

  it('相手がデスクトップのときだけ出す', () => {
    showDesktopNote(root, undefined);
    expect(root.querySelector('.live-note')).toBeNull();

    showDesktopNote(root, 'desktop');
    expect(root.querySelector('.live-note')).not.toBeNull();
  });

  it('二度呼んでも 1 つだけ', () => {
    showDesktopNote(root, 'desktop');
    showDesktopNote(root, 'desktop');

    expect(root.querySelectorAll('.live-note')).toHaveLength(1);
  });

  it('文には、押すのは大丈夫だと書く（全部だめだと読ませない）', () => {
    expect(MESSAGES.ja['live.desktop.note']).toContain('押す');
  });

  it('文には、実物を触ってほしいと書く', () => {
    expect(MESSAGES.ja['live.desktop.note']).toContain('実物');
  });
});
