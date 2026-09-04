// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderColumns } from '../../src/render.js';
import { flashVerdict, FLASH_MS } from '../../src/session/flash.js';

/**
 * 置いた判定を、**押した直後に前面へ出す。**
 *
 * 2026-09-04、実物を触った人の指定:「合格、不合格を押した時に前面に🚫不合格みたいに
 * だしてほしいですね。そっちのほうが、人はおしまちがいにきづけるので」。
 *
 * **押し間違いは「キーを離す」より「気づかせる」ほうが確実。**隣は必ずできるが、
 * 出せば毎回気づける。ライブビューを隠し続けないよう、**すぐ消える。**
 */
let root: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  renderColumns(root);
});

afterEach(() => {
  vi.useRealTimers();
});

const flash = (): HTMLElement | null => root.querySelector<HTMLElement>('.verdict-flash');

describe('flashVerdict', () => {
  it('置いたものを、記号と言葉で前面に出す', () => {
    flashVerdict(root, 'FAIL');

    expect(flash()?.textContent).toContain('🔴');
    expect(flash()?.textContent).toContain('不合格');
  });

  it('合格も出す', () => {
    flashVerdict(root, 'VERIFIED');

    expect(flash()?.textContent).toContain('🟢');
    expect(flash()?.textContent).toContain('合格');
  });

  it('AI の判定のまま進めたときも出す（人が見ていないと分かるように）', () => {
    flashVerdict(root, 'AUTO_PASS');

    expect(flash()?.textContent).toContain('⚪');
  });

  it('すぐ消える（ライブビューを隠し続けない）', () => {
    flashVerdict(root, 'VERIFIED');
    expect(flash()).not.toBeNull();

    vi.advanceTimersByTime(FLASH_MS);

    expect(flash()).toBeNull();
  });

  it('続けて押したら、後のものに置き換わる（重ならない）', () => {
    flashVerdict(root, 'VERIFIED');
    flashVerdict(root, 'FAIL');

    expect(root.querySelectorAll('.verdict-flash')).toHaveLength(1);
    expect(flash()?.textContent).toContain('不合格');
  });

  it('置き換えたら、消える時刻も入れ直す', () => {
    flashVerdict(root, 'VERIFIED');
    vi.advanceTimersByTime(FLASH_MS - 10);
    flashVerdict(root, 'FAIL');
    vi.advanceTimersByTime(20);

    // **前の消灯が後のものを消してはいけない。**出た瞬間に消えると、気づけない。
    expect(flash()).not.toBeNull();
  });

  it('知らない値では何も出さない', () => {
    flashVerdict(root, 'NOPE');

    expect(flash()).toBeNull();
  });
});
