import { describe, expect, it } from 'vitest';

import { iosAct } from '../src/adapter.js';
import type { WdaClient } from '../src/wda.js';

/**
 * **iPhone で「戻る」**（2026-10-15）。
 *
 * iPhone には物の戻るキーが無い。Windows の席で AI が MCP から BACK を送り、
 * 「送れるのは Enter と Home だけ」と断られて止まった。
 *
 * 戻り方は 2 つ。**画面左上の「<」を押す**、無ければ**左端から右へなぞる**。
 * どちらも効かなかった（画面が変わらなかった）ときは、**戻れたことにしない。**
 */
const fake = (opts: { back?: { x: number; y: number }; app?: string; screens: string[] }) => {
  const done: string[] = [];
  const screens = [...opts.screens];
  const wda: WdaClient = {
    ready: () => Promise.resolve(true),
    scale: () => Promise.resolve(3),
    tap: (at) => {
      done.push(`tap ${String(at.x)},${String(at.y)}`);
      return Promise.resolve();
    },
    type: () => Promise.resolve(),
    screenshot: () => Promise.resolve(new Uint8Array()),
    info: () => Promise.resolve({ model: 'iPhone', osVersion: '27.0.1', id: 'X' }),
    launch: () => Promise.resolve(),
    home: () => Promise.resolve(),
    texts: () => Promise.resolve(''),
    swipe: (from, to, ms) => {
      done.push(
        `swipe ${String(from.x)},${String(from.y)}→${String(to.x)},${String(to.y)} ${String(ms)}ms`,
      );
      return Promise.resolve();
    },
    navigation: () =>
      Promise.resolve({
        ...(opts.back === undefined ? {} : { back: opts.back }),
        app: opts.app ?? 'com.apple.Preferences',
        width: 402,
        height: 874,
      }),
  };
  const deps = {
    wda,
    // 呼ばれるたびに次の画面を返す（最後の 1 枚は繰り返す）。
    look: () => Promise.resolve(screens.length > 1 ? (screens.shift() ?? '') : (screens[0] ?? '')),
    settle: () => Promise.resolve(),
  };
  return { done, deps };
};

describe('iosAct — BACK', () => {
  it('「<」があれば押し、画面が変われば戻れたとする', async () => {
    const { done, deps } = fake({ back: { x: 38, y: 90 }, screens: ['一般', '設定'] });

    const report = await iosAct({ kind: 'key', key: 'BACK' }, deps);

    expect(done).toEqual(['tap 38,90']);
    expect(report.detail).toContain('左上の戻るボタン');
  });

  it('「<」が無ければ、左端から右へなぞる', async () => {
    const { done, deps } = fake({ screens: ['一般', '設定'] });

    const report = await iosAct({ kind: 'key', key: 'back' }, deps);

    expect(done).toEqual(['swipe 2,437→281,437 300ms']);
    expect(report.detail).toContain('左端から右へなぞって');
  });

  it('「<」を押しても変わらなければ、左端からなぞり直す', async () => {
    const { done, deps } = fake({ back: { x: 38, y: 90 }, screens: ['一般', '一般', '設定'] });

    const report = await iosAct({ kind: 'key', key: '戻る' }, deps);

    expect(done).toEqual(['tap 38,90', 'swipe 2,437→281,437 300ms']);
    expect(report.detail).toContain('左端から右へなぞって');
  });

  it('どちらでも画面が変わらなければ、戻れたことにしない', async () => {
    const { deps } = fake({ back: { x: 38, y: 90 }, screens: ['ホーム'] });

    await expect(iosAct({ kind: 'key', key: 'BACK' }, deps)).rejects.toThrow(/戻れなかった/);
  });

  /**
   * **ホーム画面で左端からなぞると、ウィジェットの画面が開く**（2026-10-15・実機の Xs で踏んだ）。
   * 画面は変わるので、変わったかだけで決めると「戻れた」になってしまう。
   */
  it('ホーム画面では、なぞらずに断る', async () => {
    const { done, deps } = fake({
      app: 'com.apple.springboard',
      screens: ['ホーム', 'ウィジェット'],
    });

    await expect(iosAct({ kind: 'key', key: 'BACK' }, deps)).rejects.toThrow(/ホーム画面/);
    expect(done).toEqual([]);
  });

  it('送れないキーの案内に Back も載る', async () => {
    const { deps } = fake({ screens: [''] });

    await expect(iosAct({ kind: 'key', key: 'APP_SWITCH' }, deps)).rejects.toThrow(
      /Enter・Home・Back/,
    );
  });
});
