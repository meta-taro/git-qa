// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { renderColumns } from '../../src/render.js';
import { mountLiveView } from '../../src/live/view.js';
import { showInputError } from '../../src/live/input-error.js';

/**
 * **触ったのに届かなかった理由を、画面へ出す**（外部レビュー meta-taro/git-qa#33）。
 *
 * > **問題は、それが画面に出ないこと。**ライブビューの下には
 * > 「ここから押すのは、そのまま届きます」と書いてあります。
 * > **届かなかった今回は、この案内と食い違っています。**
 *
 * 理由はターミナルにだけ流れていた。**端末は人の画面ではない。**
 * しかも**「届きます」と書いてある案内の隣で、届いていない** ——
 * 人は「押し方が悪いのか」と自分を疑うことになる。
 */
describe('showInputError', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
    mountLiveView(root, { width: 200, height: 400 });
  });

  it('届かなかった理由を、映像の所へ出す', () => {
    showInputError(root, 'dbboard を前面に出せなかった（いま前面に居るのは git-qa-desktop）');

    expect(root.querySelector('.live-input-error')?.textContent).toContain('前面に出せなかった');
  });

  /** **直ったら消す。**出したままだと、直っているのに直っていないように見える。 */
  it('届くようになったら、消す', () => {
    showInputError(root, '前面に出せなかった');
    showInputError(root, undefined);

    expect(root.querySelector('.live-input-error')).toBeNull();
  });

  it('二重に出さない', () => {
    showInputError(root, 'あ');
    showInputError(root, 'い');

    expect(root.querySelectorAll('.live-input-error')).toHaveLength(1);
    expect(root.querySelector('.live-input-error')?.textContent).toContain('い');
  });

  /**
   * **「そのまま届きます」の案内と食い違わせない**（#33 の提案 3）。
   * 届かなかった間は、その案内を打ち消す。
   */
  it('届かない間は、「そのまま届きます」の案内を打ち消す', () => {
    const note = root.ownerDocument.createElement('p');
    note.className = 'live-note';
    note.textContent = 'ここから押すのは、そのまま届きます';
    root.querySelector('[data-column-id="live"]')?.append(note);

    showInputError(root, '前面に出せなかった');

    expect(note.dataset['stale']).toBe('true');
  });
});
