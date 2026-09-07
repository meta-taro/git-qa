import { describe, expect, it } from 'vitest';

import {
  anyWindowScript,
  captureArgs,
  missingWindowMessage,
  parseWindow,
  windowScript,
} from '../src/window.js';

/**
 * 見る窓を決めて、撮る（C55）。
 *
 * **見るほうは段が要らない。**どのアプリでも同じ手で撮れる
 * （実測 2026-09-06: 118 ms / 枚・約 8.5 fps）。
 * 段が要るのは触るほうだけ。
 */

describe('windowScript', () => {
  it('アプリ名をそのまま埋め込まない（引用符を閉じられると別の命令になる）', () => {
    // product-baseline §21。JXA の中で走る文なので、閉じられると何でもできる。
    expect(windowScript('ev"il')).toContain(JSON.stringify('ev"il'));
    expect(windowScript('ev"il')).not.toContain('"ev"il"');
  });

  it('日本語のアプリ名も落とさない（メモ・計算機など）', () => {
    expect(windowScript('計算機')).toContain(JSON.stringify('計算機'));
  });

  it('窓の一覧を OS へ直接聞く', () => {
    expect(windowScript('メモ')).toContain('CGWindowListCopyWindowInfo');
  });

  it('メニューバーや Dock を掴まない（layer 0 の窓だけ）', () => {
    expect(windowScript('メモ')).toContain('kCGWindowLayer');
  });
});

describe('parseWindow', () => {
  /**
   * **持ち主の番号（pid）も読む**（2026-09-07）。
   *
   * 押すのを「画面のこの座標」ではなく「**このアプリのこの座標**」へ送るようにしたので、
   * 相手の pid が要る。これで前面に出さずに押せるようになった。
   */
  it('番号と持ち主と位置と大きさを読む', () => {
    expect(parseWindow('217, 1398, 100, 50, 800, 600')).toEqual({
      id: 217,
      pid: 1398,
      x: 100,
      y: 50,
      width: 800,
      height: 600,
    });
  });

  it('見つからなければ undefined（当て推量で撮らない）', () => {
    expect(parseWindow('missing value')).toBeUndefined();
    expect(parseWindow('')).toBeUndefined();
    expect(parseWindow('217, 100')).toBeUndefined();
  });

  it('持ち主の番号が取れなければ押せないので undefined', () => {
    expect(parseWindow('217, 0, 100, 50, 800, 600')).toBeUndefined();
  });

  it('大きさの無い窓は撮らない（畳まれている・出来かけ）', () => {
    expect(parseWindow('217, 1398, 0, 0, 0, 0')).toBeUndefined();
  });
});

/**
 * **画面の四角ではなく窓そのものを撮る。**
 * 2026-09-04、`-R x,y,w,h` で撮っていたら手前に重なった別アプリが写った（`app_screenshot`）。
 * 同じ間違いをここで繰り返さない。
 */
describe('captureArgs', () => {
  it('窓の番号を指して撮る（音も影も無し）', () => {
    expect(captureArgs(217, '/tmp/a.jpg')).toEqual([
      '-x',
      '-o',
      '-t',
      'jpg',
      '-l',
      '217',
      '/tmp/a.jpg',
    ]);
  });

  it('画面の四角で切らない（手前に重なった窓を写さない）', () => {
    expect(captureArgs(217, '/tmp/a.jpg')).not.toContain('-R');
  });
});

/**
 * **2026-09-07、人がライブビューを押しても何も起きなかった。**
 *
 * ログにはこれが 16 回並んでいた。
 *
 *   窓が見つからなくなった: Electron（閉じられていないかを見る）
 *
 * **閉じてはいなかった。**`kCGWindowListOptionOnScreenOnly` は
 * 「いま画面に出ている窓」しか返さない。別のデスクトップ（Space）に居る・
 * 最小化されている・フルスクリーンの裏、のいずれでも消える。
 * **「無い」と「見えていない」を同じ文言にしない。**
 */
describe('anyWindowScript', () => {
  it('画面に出ていない窓も数える（見えていないだけ、を見分けるため）', () => {
    const script = anyWindowScript('Electron');

    // 0 = 全部（1 は「いま画面に出ているものだけ」）
    expect(script).toContain('CGWindowListCopyWindowInfo(0, 0)');
    expect(script).toContain('"Electron"');
  });
});

describe('missingWindowMessage', () => {
  it('本当に無いなら、起動を促す', () => {
    const message = missingWindowMessage('Electron', 0);

    expect(message).toContain('起動');
    expect(message).not.toContain('デスクトップ');
  });

  it('あるのに見えていないなら、そう言う', () => {
    const message = missingWindowMessage('Electron', 1);

    expect(message).toContain('画面に出ていない');
    expect(message).toContain('デスクトップ');
    expect(message).toContain('最小化');
  });
});
