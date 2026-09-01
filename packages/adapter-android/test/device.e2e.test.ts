import { describe, expect, it } from 'vitest';

import { createAndroidAdapter } from '../src/index.js';

/**
 * 実機（またはエミュレータ）に当てる検査。**既定では走らない。**
 *
 * product-baseline §4 のとおり、外部に繋がるテストは繋がらない環境でも走る形にする。
 * ここは `GIT_QA_ANDROID_E2E=1` を付けたときだけ動く。
 *
 *   adb devices で端末が見えている状態で:
 *   GIT_QA_ANDROID_E2E=1 pnpm test:run
 *
 * **Fake が通ることは、実機で動くことの確認ではない。**その差を埋めるのがこのファイル。
 */
const enabled = process.env['GIT_QA_ANDROID_E2E'] === '1';

describe.skipIf(!enabled)('実機（adb / scrcpy が要る）', () => {
  const build = { source: 'example/sample-notes-app', label: 'e2e' };

  it('繋いで、端末の型番と OS の版が取れる', async () => {
    const session = await createAndroidAdapter({ build }).connect();
    expect(session.target.kind).toBe('android');
    if (session.target.kind === 'android') {
      expect(session.target.device).not.toBe('');
      expect(session.target.osVersion).toMatch(/^\d+/);
    }
    await session.close();
  });

  it('画面の状態が uiautomator の XML として取れる', async () => {
    const session = await createAndroidAdapter({ build }).connect();
    const observation = await session.observe();
    expect(typeof observation.raw).toBe('string');
    expect(observation.raw as string).toContain('<hierarchy');
    await session.close();
  });

  it('スクリーンショットが PNG として取れる', async () => {
    const session = await createAndroidAdapter({ build }).connect();
    const shot = await session.screenshot();
    // PNG の署名。中身までは見ないが、空でないことと形は確かめる。
    expect([...shot.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(shot.bytes.byteLength).toBeGreaterThan(1000);
    await session.close();
  }, 30000);

  it('操作すると画面が変わる', async () => {
    const session = await createAndroidAdapter({ build }).connect();
    await session.act({ kind: 'key', key: 'home' });
    const before = (await session.observe()).raw as string;
    await session.act({
      kind: 'swipe',
      from: { at: 'point', x: 540, y: 1500 },
      to: { at: 'point', x: 540, y: 500 },
    });
    const after = (await session.observe()).raw as string;
    // 同じ画面のままなら、操作が届いていない。
    expect(after).not.toBe(before);
    await session.close();
  }, 60000);
});
