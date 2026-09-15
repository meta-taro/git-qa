// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderColumns, updateColumnTexts } from '../src/render.js';
import { foldColumn, installFolding, isFolded } from '../src/fold.js';
import type { SettingStore } from '../src/setting-store.js';

/**
 * **脇を畳んで、映像に幅を返す**（外部レビュー meta-taro/git-qa#17）。
 *
 * > | 相手の窓 | **1280** px 幅 |
 * > | 映像の枠 | **803** px 幅 |
 * > | 表示倍率 | **63%** |
 * >
 * > **この時点で画素の 3 分の 1 以上が捨てられていて、あとからいくら拡大しても戻りません。**
 *
 * 横を食っているのは**常設の脇**（ケース一覧 約 250px ＋ 判定パネル 約 260px）。
 * 返してもらえれば 63% → 約 82%。**拡大より効く**（補間ではなく、本物の画素が増える）。
 *
 * **中央は畳めない。**畳めるようにすると、この製品の主媒体（C4）が消せてしまう。
 */
describe('脇のカラムを畳む', () => {
  let root: HTMLElement;
  let store: SettingStore;
  let kept: Record<string, string>;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
    kept = {};
    store = {
      getItem: (key) => kept[key] ?? null,
      setItem: (key, value) => {
        kept[key] = value;
      },
    };
  });

  it('畳むと、そのカラムが畳まれた印を持つ', () => {
    foldColumn(root, 'cases', true);

    expect(isFolded(root, 'cases')).toBe(true);
  });

  it('開くと、印が外れる', () => {
    foldColumn(root, 'cases', true);
    foldColumn(root, 'cases', false);

    expect(isFolded(root, 'cases')).toBe(false);
  });

  /** **主媒体は畳ませない**（C4）。人が見て判定を置く所が消えると、この道具の値打ちが消える。 */
  it('中央は畳めない', () => {
    foldColumn(root, 'live', true);

    expect(isFolded(root, 'live')).toBe(false);
  });

  it('畳む口は、脇のカラムだけに付く', () => {
    installFolding(root, store);

    expect(root.querySelectorAll('.column-fold')).toHaveLength(2);
    expect(root.querySelector('[data-column-id="live"] .column-fold')).toBeNull();
  });

  it('押すと畳み、もう一度押すと開く', () => {
    installFolding(root, store);
    const button = root.querySelector<HTMLButtonElement>('[data-column-id="cases"] .column-fold');

    button?.click();
    expect(isFolded(root, 'cases')).toBe(true);

    button?.click();
    expect(isFolded(root, 'cases')).toBe(false);
  });

  /** **次に開いたときも、そのまま。**毎回畳み直させない。 */
  it('畳んだことを覚える', () => {
    installFolding(root, store);
    root.querySelector<HTMLButtonElement>('[data-column-id="verdict"] .column-fold')?.click();

    // 画面を作り直す（アプリを開き直したのと同じ）。
    renderColumns(root);
    installFolding(root, store);

    expect(isFolded(root, 'verdict')).toBe(true);
  });

  /** **覚えられない機械でも畳める。**`localStorage` が切られていることがある。 */
  it('覚える口が無くても畳める', () => {
    installFolding(root, undefined);

    root.querySelector<HTMLButtonElement>('[data-column-id="cases"] .column-fold')?.click();

    expect(isFolded(root, 'cases')).toBe(true);
  });

  /** **畳んだら、開く口だけは残す。**戻せない畳み方をしない。 */
  it('畳んでも、開く口は残る', () => {
    installFolding(root, store);
    const button = root.querySelector<HTMLButtonElement>('[data-column-id="cases"] .column-fold');
    button?.click();

    expect(button?.isConnected).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
  });

  it('畳んだ幅が変わったことを、外へ知らせる', () => {
    const told = vi.fn();
    installFolding(root, store, told);

    root.querySelector<HTMLButtonElement>('[data-column-id="cases"] .column-fold')?.click();

    expect(told).toHaveBeenCalled();
  });
});

/**
 * **言語を描き直しても、畳む口を消さない**（2026-09-15・実物で踏んだ）。
 *
 * 単体の検査は通っていたのに、**アプリでは口が出てこなかった。**
 * `updateColumnTexts` が見出しを `textContent` で書き換えていて、
 * **中に足した部品ごと消していた。**起動直後に 1 回走るので、いつも消えていた。
 *
 * **画面を実際に見るまで気づけなかった。**この製品が「人が実物を見る」ことを
 * 値打ちにしているのと、同じ形の失敗。
 */
describe('言語の描き直しと、畳む口', () => {
  it('文言を描き直しても、口は残る', () => {
    const root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
    installFolding(root, undefined);

    updateColumnTexts(root);

    expect(root.querySelectorAll('.column-fold')).toHaveLength(2);
  });

  it('描き直しても、畳んだままの姿は変わらない', () => {
    const root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
    installFolding(root, undefined);
    root.querySelector<HTMLButtonElement>('[data-column-id="cases"] .column-fold')?.click();

    updateColumnTexts(root);

    expect(isFolded(root, 'cases')).toBe(true);
  });
});
