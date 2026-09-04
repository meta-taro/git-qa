import { describe, expect, it } from 'vitest';

import { boundsScript, captureArgs, createWindowCapture, parseBounds } from '../src/screen.js';

/**
 * **画面を自分で見る。**
 *
 * これが無いと、AI は「右のカラムに何が出ていますか」と人へ聞くしかない。
 * 実際に 2 度聞き、そのあいだに人の作業が消えた（2026-09-04）。
 * **人に目の代わりをさせない。**
 */

describe('parseBounds', () => {
  it('AppleScript が返す 4 つの数を読む', () => {
    expect(parseBounds('12, 34, 800, 600')).toEqual({ x: 12, y: 34, width: 800, height: 600 });
  });

  it('窓が見つからないときは undefined（当て推量で撮らない）', () => {
    expect(parseBounds('')).toBeUndefined();
    expect(parseBounds('missing value')).toBeUndefined();
  });

  it('大きさが 0 の窓は撮らない', () => {
    expect(parseBounds('0, 0, 0, 0')).toBeUndefined();
  });
});

describe('captureArgs', () => {
  it('窓の範囲だけを、音も影も無しで撮る', () => {
    const args = captureArgs({ x: 12, y: 34, width: 800, height: 600 }, '/tmp/a.png');

    expect(args).toEqual(['-x', '-o', '-R', '12,34,800,600', '/tmp/a.png']);
  });
});

describe('boundsScript', () => {
  it('アプリ名をそのまま埋め込まない（引用符を閉じられると別の命令になる）', () => {
    expect(boundsScript('ev"il')).not.toContain('ev"il');
  });
});

describe('createWindowCapture', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it('撮った絵を base64 で返す', async () => {
    const ran: string[][] = [];
    const capture = createWindowCapture({
      run: (command, args) => {
        ran.push([command, ...args]);
        return Promise.resolve(command === 'osascript' ? '12, 34, 800, 600' : '');
      },
      readFile: () => Promise.resolve(png),
      tmpPath: () => '/tmp/shot.png',
    });

    const shot = await capture('git-qa');

    expect(shot.mimeType).toBe('image/png');
    expect(shot.base64).toBe(Buffer.from(png).toString('base64'));
    expect(ran[0]?.[0]).toBe('osascript');
    expect(ran[1]).toEqual(['screencapture', '-x', '-o', '-R', '12,34,800,600', '/tmp/shot.png']);
  });

  it('窓が見つからなければ、理由を出す（黙って空の絵を返さない）', async () => {
    const capture = createWindowCapture({
      run: () => Promise.resolve('missing value'),
      readFile: () => Promise.resolve(png),
      tmpPath: () => '/tmp/shot.png',
    });

    await expect(capture('git-qa')).rejects.toThrow(/git-qa/);
  });
});

/**
 * **窓だけを撮るには、アクセシビリティの許可が要る**（窓の位置を聞くため）。
 * 許可が無い機械でも、画面全体なら撮れる（画面収録の許可だけで足りる）。
 * **撮れないまま黙らない。**どちらが要るのかを言う。
 */
describe('許可が足りないとき', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it('画面全体は、窓の位置を聞かずに撮る', async () => {
    const ran: string[][] = [];
    const capture = createWindowCapture({
      run: (command, args) => {
        ran.push([command, ...args]);
        return Promise.resolve('');
      },
      readFile: () => Promise.resolve(png),
      tmpPath: () => '/tmp/shot.png',
    });

    await capture('git-qa', 'screen');

    expect(ran).toEqual([['screencapture', '-x', '-o', '/tmp/shot.png']]);
  });

  it('窓の位置を聞けなかったら、何の許可が要るかを言う', async () => {
    const capture = createWindowCapture({
      run: (command) => {
        if (command === 'osascript') {
          return Promise.reject(new Error('osascriptには補助アクセスは許可されません。 (-25211)'));
        }
        return Promise.resolve('');
      },
      readFile: () => Promise.resolve(png),
      tmpPath: () => '/tmp/shot.png',
    });

    await expect(capture('git-qa')).rejects.toThrow(/アクセシビリティ/);
  });
});
