import { describe, expect, it } from 'vitest';

import { createSafariSession } from '../src/safari-adapter.js';
import type { WebDriverClient } from '../src/webdriver.js';

/**
 * **Safari でも、人が見る場所を指す**（2026-09-25・人の指示）。
 *
 * > Firefox は優先度低いですが、**Safari はひつようでしょうね。**
 *
 * Chrome には在って Safari に無かったのは 2 つ。
 *
 * 1. `screenSize` —— 無いと実行側が**指した場所を丸ごと捨てる**（赤い枠も矢印も出ない）
 * 2. `onPointed` / `locate` —— 無いと**指す所がそもそも知らされない**
 *
 * **ブラウザを起こさずに確かめる**（product-baseline §4）。WebDriver の口を差し替える。
 */

interface Asked {
  readonly scripts: string[];
  readonly actions: unknown[];
}

/** WebDriver の代わり。**Safari を起こさない。** */
function fakeClient(found: Record<string, unknown>, viewport: unknown): WebDriverClient & Asked {
  const scripts: string[] = [];
  const actions: unknown[] = [];

  return {
    sessionId: 'fake',
    scripts,
    actions,
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    post: (path: string, body: unknown): Promise<unknown> => {
      if (path === '/actions') {
        actions.push(body);
        return Promise.resolve(undefined);
      }
      const script = (body as { script?: string } | undefined)?.script ?? '';
      scripts.push(script);
      if (script.includes('innerWidth')) return Promise.resolve(viewport);
      for (const [ref, value] of Object.entries(found)) {
        if (script.includes(JSON.stringify(ref))) return Promise.resolve(value);
      }
      return Promise.resolve(undefined);
    },
  };
}

const sessionWith = (
  client: WebDriverClient,
  onPointed?: (at: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    label?: string;
  }) => void,
) =>
  createSafariSession({
    client,
    cleanup: () => Promise.resolve(),
    options: {
      build: { source: 'example/site', label: 'dev' },
      settleMs: 0,
      ...(onPointed === undefined ? {} : { onPointed }),
    },
    now: () => new Date('2026-09-25T00:00:00.000Z'),
    label: 'Safari',
  });

describe('Safari — 人が見る場所を指す', () => {
  it('見える大きさを、ブラウザに聞いて返す', async () => {
    const client = fakeClient({}, { width: 1440, height: 812 });
    const session = sessionWith(client);

    await expect(session.screenSize?.()).resolves.toEqual({ width: 1440, height: 812 });
    expect(client.scripts.some((s) => s.includes('innerWidth'))).toBe(true);
  });

  /** **測れないまま既定を返さない。**当て推量の大きさは、見当違いの所を押させる。 */
  it('大きさを読めなかったら、そう言って落ちる', async () => {
    const session = sessionWith(fakeClient({}, undefined));

    await expect(session.screenSize?.()).rejects.toThrow(/見える大きさ/);
  });

  it('押さずに指せる（赤い枠に要る大きさも渡す）', async () => {
    const seen: unknown[] = [];
    const session = sessionWith(
      fakeClient({ 保存: { x: 100, y: 200, width: 40, height: 20 } }, { width: 1440, height: 812 }),
      (at) => seen.push(at),
    );

    await expect(session.locate?.('保存')).resolves.toBe(true);
    expect(seen).toEqual([{ x: 100, y: 200, width: 40, height: 20, label: '保存' }]);
  });

  it('見つからなければ false を返し、指さない', async () => {
    const seen: unknown[] = [];
    const session = sessionWith(fakeClient({}, { width: 1440, height: 812 }), (at) =>
      seen.push(at),
    );

    await expect(session.locate?.('無い')).resolves.toBe(false);
    expect(seen).toEqual([]);
  });

  /** **指した所と押す所を、別の道で探さない。**別々にすると、指した所と違う所を押す。 */
  it('押すときも、同じ道で指す', async () => {
    const seen: unknown[] = [];
    const client = fakeClient(
      { 保存: { x: 100, y: 200, width: 40, height: 20 } },
      { width: 1440, height: 812 },
    );
    const session = sessionWith(client, (at) => seen.push(at));

    await session.act({ kind: 'tap', target: { at: 'element', ref: '保存' } });

    expect(seen).toEqual([{ x: 100, y: 200, width: 40, height: 20, label: '保存' }]);
    expect(client.actions).toHaveLength(1);
  });
});
