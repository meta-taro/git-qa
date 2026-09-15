// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { renderColumns } from '../../src/render.js';
import { mountLiveView } from '../../src/live/view.js';
import { showStretchNote } from '../../src/live/stretch.js';

/**
 * **引き伸ばしていることを、画面が言う**（外部レビュー meta-taro/git-qa#17）。
 *
 * > 1:1 を超えたら、そう言う。「ここから先は引き伸ばしなので、細部は増えません」と
 * > 画面が言えると、人は無駄に押さずに済みます。
 * > **いまは押せてしまうので「効かない道具」に見えます。**
 */
describe('showStretchNote', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
    mountLiveView(root, { width: 1280, height: 800 });
  });

  it('1 対 1 を超えたら、そう言う', () => {
    showStretchNote(root, 1.6);

    expect(root.querySelector('.live-stretched')?.textContent).toContain('1.6');
  });

  /** **足りているうちは黙る。**いつも出ていると、読まなくなる（矢印のときと同じ話）。 */
  it('足りているうちは出さない', () => {
    showStretchNote(root, 1.6);
    showStretchNote(root, 0.9);

    expect(root.querySelector('.live-stretched')).toBeNull();
  });

  /** **測れないなら黙る。**当てずっぽうの数を出さない。 */
  it('測れないときは出さない', () => {
    showStretchNote(root, undefined);

    expect(root.querySelector('.live-stretched')).toBeNull();
  });

  /** ちょうど 1 対 1 は「引き伸ばし」ではない。**境目で騒がない。** */
  it('ちょうど 1 対 1 では出さない', () => {
    showStretchNote(root, 1);

    expect(root.querySelector('.live-stretched')).toBeNull();
  });

  it('二重に出さない', () => {
    showStretchNote(root, 1.6);
    showStretchNote(root, 2.4);

    expect(root.querySelectorAll('.live-stretched')).toHaveLength(1);
    expect(root.querySelector('.live-stretched')?.textContent).toContain('2.4');
  });
});
