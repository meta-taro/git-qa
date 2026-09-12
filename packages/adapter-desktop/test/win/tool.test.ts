import { describe, expect, it } from 'vitest';

import { parseWinWindows, winArgs } from '../../src/win/tool.js';

/**
 * **Windows のデスクトップ検証**（2026-09-12・人の指示）。
 *
 * > デスクトップアプリ試験導入予定なんです。……顧客対象が大抵 win なので、
 * > win で検証する必要があります。
 *
 * macOS 側の 3 本（OCR / 触る / 録る）に当たるものを、Windows では 1 本にまとめてある
 * （窓・文字・操作がどれも Win32 と UI Automation から取れるため）。
 *
 * **出す形は macOS と揃えてある。**読む側（ここ）を OS ごとに分けないため ——
 * 文字の一覧は `name \t x \t y \t w \t h` で、`parseOcr` がそのまま読める。
 */

describe('winArgs', () => {
  it('窓を探す', () => {
    expect(winArgs.windows('dbboard')).toEqual(['windows', 'dbboard']);
  });

  it('窓 1 つを撮る', () => {
    expect(winArgs.shot(1234, '/tmp/a.png')).toEqual(['shot', '1234', '/tmp/a.png']);
  });

  it('文字を読む', () => {
    expect(winArgs.text(1234)).toEqual(['text', '1234']);
  });

  /** **座標は整数で渡す。**小数を渡すと、道具の側で弾かれる。 */
  it('押す場所は丸めて渡す', () => {
    expect(winArgs.press(1234, 10.6, 20.2)).toEqual(['press', '1234', '11', '20']);
  });

  it('実行ファイルの場所を聞く（指紋用）', () => {
    expect(winArgs.exe(4321)).toEqual(['exe', '4321']);
  });
});

describe('parseWinWindows', () => {
  const said = [
    '65540\t1398\tC:\\Program Files\\dbboard\\dbboard.exe\tdbboard\t100\t80\t1280\t800',
    '65600\t2000\tC:\\Windows\\explorer.exe\tエクスプローラー\t0\t0\t800\t600',
  ].join('\n');

  it('窓を読む', () => {
    const [first] = parseWinWindows(said);

    expect(first).toEqual({
      hwnd: 65540,
      pid: 1398,
      exe: 'C:\\Program Files\\dbboard\\dbboard.exe',
      title: 'dbboard',
      x: 100,
      y: 80,
      width: 1280,
      height: 800,
    });
  });

  it('見つかった数だけ返す', () => {
    expect(parseWinWindows(said)).toHaveLength(2);
  });

  /** **読めない行は捨てる。**当て推量で別の窓を触らない。 */
  it('形のおかしい行は捨てる', () => {
    expect(parseWinWindows('こわれている\n65540\t1\tC:\\a.exe\ta\t0\t0\t10\t10')).toHaveLength(1);
  });

  /** 1 つも無いのは**普通のこと**（まだ起動していない）。 */
  it('何も無ければ空', () => {
    expect(parseWinWindows('')).toEqual([]);
  });

  /** **大きさの無い窓は返さない。**撮れないし、押す場所も決まらない。 */
  it('大きさの無い窓は捨てる', () => {
    expect(parseWinWindows('65540\t1\tC:\\a.exe\ta\t0\t0\t0\t0')).toEqual([]);
  });
});
