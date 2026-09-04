import { describe, expect, it } from 'vitest';

import {
  captureArgs,
  createWindowCapture,
  parseAllowed,
  parseWindowId,
  screenCaptureAllowedScript,
  windowIdScript,
} from '../src/screen.js';

/**
 * **画面を自分で見る。**
 *
 * これが無いと、AI は「右のカラムに何が出ていますか」と人へ聞くしかない。
 * 実際に 2 度聞き、そのあいだに人の作業が消えた（2026-09-04）。
 * **人に目の代わりをさせない。**
 */

describe('parseWindowId', () => {
  it('窓の番号を読む', () => {
    expect(parseWindowId('217')).toBe(217);
  });

  it('窓が見つからないときは undefined（当て推量で撮らない）', () => {
    expect(parseWindowId('')).toBeUndefined();
    expect(parseWindowId('missing value')).toBeUndefined();
  });

  it('番号になっていない返事は読まない', () => {
    expect(parseWindowId('0')).toBeUndefined();
    expect(parseWindowId('-1')).toBeUndefined();
    expect(parseWindowId('21.7')).toBeUndefined();
  });
});

/**
 * **画面の四角ではなく、窓そのものを撮る。**
 *
 * 2026-09-04、`app_screenshot` が git-qa の絵として**別のプロジェクトのアプリ**を返した。
 * 窓の位置を聞いて `-R x,y,w,h` で切っていたため、**手前に重なった窓がそのまま入っていた。**
 * エラーは出ない。前の日の「許可が無いと壁紙が返る」と同じ、**黙って違う絵を返す**壊れ方。
 *
 * 証跡に残る絵であり、**リポジトリは public**。無関係なアプリの中身が写る経路は塞ぐ。
 */
describe('captureArgs', () => {
  it('窓の番号を指して撮る（音も影も無し）', () => {
    expect(captureArgs(217, '/tmp/a.png')).toEqual(['-x', '-o', '-l', '217', '/tmp/a.png']);
  });

  it('画面の四角で切らない（手前に重なった窓を写さない）', () => {
    expect(captureArgs(217, '/tmp/a.png')).not.toContain('-R');
  });
});

describe('windowIdScript', () => {
  it('窓の一覧を OS へ直接聞く', () => {
    expect(windowIdScript('git-qa')).toContain('CGWindowListCopyWindowInfo');
  });

  it('メニューバーや Dock を掴まない（layer 0 の窓だけ）', () => {
    expect(windowIdScript('git-qa')).toContain('kCGWindowLayer');
  });

  it('アプリ名をそのまま埋め込まない（引用符を閉じられると別の命令になる）', () => {
    expect(windowIdScript('ev"il')).not.toContain('"ev"il"');
  });

  it('日本語のアプリ名も落とさない（ターミナル等）', () => {
    expect(windowIdScript('ターミナル')).toContain('ターミナル');
  });
});

describe('createWindowCapture', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it('撮った絵を base64 で返す', async () => {
    const ran: string[][] = [];
    const capture = createWindowCapture({
      run: (command, args) => {
        ran.push([command, ...args]);
        return Promise.resolve(command === 'osascript' ? '217' : '');
      },
      readFile: () => Promise.resolve(png),
      tmpPath: () => '/tmp/shot.png',
    });

    const shot = await capture('git-qa');

    expect(shot.mimeType).toBe('image/png');
    expect(shot.base64).toBe(Buffer.from(png).toString('base64'));
    // 1 本目は画面収録の許可を聞く、2 本目が窓の番号。**撮るのは最後。**
    expect(ran[0]?.[0]).toBe('osascript');
    expect(ran[1]?.[0]).toBe('osascript');
    expect(ran[2]).toEqual(['screencapture', '-x', '-o', '-l', '217', '/tmp/shot.png']);
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
 * 画面全体は、窓の番号を聞かずに撮れる。
 * **撮れないまま黙らない。**何が起きたのかを言う。
 */
describe('聞けなかったとき', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  it('画面全体は、窓の番号を聞かずに撮る', async () => {
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

    // **窓の番号は聞かない。**画面収録の許可だけは聞く —— 無いと嘘の絵が返るため。
    expect(ran.filter((call) => call[0] === 'osascript')).toHaveLength(1);
    expect(ran.at(-1)).toEqual(['screencapture', '-x', '-o', '/tmp/shot.png']);
  });

  it('窓の番号を聞けなかったら、元の理由ごと出す', async () => {
    const capture = createWindowCapture({
      run: (command, args) => {
        if (command === 'osascript' && args.join(' ').includes('CGWindowList')) {
          return Promise.reject(new Error('osascript が落ちた (-1743)'));
        }
        return Promise.resolve('true');
      },
      readFile: () => Promise.resolve(png),
      tmpPath: () => '/tmp/shot.png',
    });

    await expect(capture('git-qa')).rejects.toThrow(/-1743/);
    // **代わりの手を示す。**言わないと人は動けない。
    await expect(capture('git-qa')).rejects.toThrow(/screen/);
  });
});

/**
 * **許可が無いことを、道具が自分で言う。**
 *
 * 2026-09-04、`app_screenshot` を 3 回撮り、3 回とも壁紙だけが返った。
 * 窓が 1 つも写らない —— 人が開いているターミナルの窓すら写らなかった。
 *
 * **画面収録の許可が無いとき、macOS の `screencapture` はエラーを返さない。**
 * 実測: `exit=0`・stderr は空・PNG は 4.3 MB。窓を全部消した絵が返る。
 * 危うく「窓が出ていない」と報告するところだった。
 * **見えない道具より、嘘をつく道具のほうが悪い。**
 */
describe('画面収録の許可', () => {
  it('許可の有無を OS へ直接聞く', () => {
    expect(screenCaptureAllowedScript()).toContain('CGPreflightScreenCaptureAccess');
  });

  it('返事を読む', () => {
    expect(parseAllowed('true')).toBe(true);
    expect(parseAllowed('false')).toBe(false);
  });

  it('読めない返事は「分からない」（塞がない）', () => {
    // 古い macOS・macOS 以外。**確かめられないことを理由に、手を止めない。**
    expect(parseAllowed('')).toBeUndefined();
    expect(parseAllowed('なんだこれ')).toBeUndefined();
  });

  it('許可が無いと分かっているときは、撮らずに落ちる', async () => {
    const calls: string[] = [];
    const capture = createWindowCapture({
      run: (command) => {
        calls.push(command);
        return Promise.resolve(command === 'osascript' ? 'false' : '');
      },
      readFile: () => Promise.resolve(new Uint8Array()),
      tmpPath: () => '/tmp/a.png',
    });

    await expect(capture('git-qa', 'screen')).rejects.toThrow(/画面収録/);
    // **壁紙だけの絵を返さない。**撮ること自体をしない。
    expect(calls).not.toContain('screencapture');
  });

  it('落ちるときは、どこで許可するかまで言う', async () => {
    const capture = createWindowCapture({
      run: (command) => Promise.resolve(command === 'osascript' ? 'false' : ''),
      readFile: () => Promise.resolve(new Uint8Array()),
      tmpPath: () => '/tmp/a.png',
    });

    await expect(capture('git-qa', 'screen')).rejects.toThrow(
      /プライバシーとセキュリティ[\s\S]*開き直す/,
    );
  });

  it('許可があれば、今までどおり撮る', async () => {
    const calls: string[] = [];
    const capture = createWindowCapture({
      run: (command) => {
        calls.push(command);
        return Promise.resolve(command === 'osascript' ? 'true' : '');
      },
      readFile: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      tmpPath: () => '/tmp/a.png',
    });

    expect((await capture('git-qa', 'screen')).mimeType).toBe('image/png');
    expect(calls).toContain('screencapture');
  });

  it('確かめられないときも撮る（分からないことで止めない）', async () => {
    const capture = createWindowCapture({
      run: (command) =>
        command === 'osascript'
          ? Promise.reject(new Error('osascript が無い'))
          : Promise.resolve(''),
      readFile: () => Promise.resolve(new Uint8Array([1])),
      tmpPath: () => '/tmp/a.png',
    });

    expect((await capture('git-qa', 'screen')).mimeType).toBe('image/png');
  });
});
