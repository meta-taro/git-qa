import { describe, expect, it } from 'vitest';

import { codecFromAnnexB, createAnnexBSplitter } from '@git-qa/core/live';

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

/**
 * 当てる端末。**複数見えているときは指定が要る**（指定が無ければ選ばずに落ちる・C31）。
 * 実機とエミュレータを同時に繋いでいる場面は普通にある。
 */
const serial = process.env['GIT_QA_ANDROID_SERIAL'];
const target = serial === undefined ? {} : { serial };

describe.skipIf(!enabled)('実機（adb / scrcpy が要る）', () => {
  const build = { source: 'example/sample-notes-app', label: 'e2e' };

  it('繋いで、端末の型番と OS の版が取れる', async () => {
    const session = await createAndroidAdapter({ build, ...target }).connect();
    expect(session.target.kind).toBe('android');
    if (session.target.kind === 'android') {
      expect(session.target.device).not.toBe('');
      expect(session.target.osVersion).toMatch(/^\d+/);
    }
    await session.close();
  });

  it('画面の状態が uiautomator の XML として取れる', async () => {
    const session = await createAndroidAdapter({ build, ...target }).connect();
    const observation = await session.observe();
    expect(typeof observation.raw).toBe('string');
    expect(observation.raw as string).toContain('<hierarchy');
    await session.close();
  });

  it('スクリーンショットが PNG として取れる', async () => {
    const session = await createAndroidAdapter({ build, ...target }).connect();
    const shot = await session.screenshot();
    // PNG の署名。中身までは見ないが、空でないことと形は確かめる。
    expect([...shot.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(shot.bytes.byteLength).toBeGreaterThan(1000);
    await session.close();
  }, 30000);

  it('操作すると画面が変わる', async () => {
    const session = await createAndroidAdapter({ build, ...target }).connect();
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
  it('screenrecord の生 H.264 が流れてきて、アクセスユニットに切れる', async () => {
    // D6 の選択肢 B（ADR 0003）が実際に成立するかを見る。
    // ここが通らなければ、scrcpy のサーバへ繋ぐ側（選択肢 A）へ進む根拠になる。
    const session = await createAndroidAdapter({
      build,
      ...target,
      liveView: { mode: 'h264-stream', timeLimitSec: 30 },
    }).connect();
    await session.liveView.open();

    // **画面が変化しないとフレームが出ない**（scrcpy も screenrecord も同じ）。
    // 静止した画面を読んでも「流れていない」のか「変化が無い」のか区別できないので、
    // 読みながら操作を流す。
    let stirring = true;
    const stir = (async () => {
      while (stirring) {
        await session.act({
          kind: 'swipe',
          from: { at: 'point', x: 540, y: 1400 },
          to: { at: 'point', x: 540, y: 500 },
        });
      }
    })();

    const splitter = createAnnexBSplitter();
    const startedAt = Date.now();
    let bytes = 0;
    let firstUnitMs: number | undefined;
    const units: { isKey: boolean }[] = [];

    try {
      for await (const chunk of session.liveView.frames?.() ?? []) {
        bytes += chunk.byteLength;
        for (const unit of splitter.push(chunk)) {
          firstUnitMs ??= Date.now() - startedAt;
          units.push(unit);
        }
        // 30 枚あれば「流れて切れている」ことは言える。長く回さない。
        if (units.length >= 30) break;
      }
    } finally {
      stirring = false;
      await stir;
    }
    units.push(...splitter.flush());
    const elapsedMs = Date.now() - startedAt;
    await session.liveView.close();
    await session.close();

    // 実測値をログへ出す。テストの合否とは別に、Issue 005 / 007 の材料になる。
    console.log(
      `[screenrecord] ${String(bytes)} バイト / ${String(units.length)} 枚 / ` +
        `${String(elapsedMs)} ms / 最初の 1 枚まで ${String(firstUnitMs)} ms`,
    );

    expect(bytes).toBeGreaterThan(0);
    expect(units.length).toBeGreaterThanOrEqual(30);
    // 先頭には必ず IDR が来る。来なければ、途中から拾っていて復号を始められない。
    expect(units.some((u) => u.isKey)).toBe(true);
    // 最初の 1 枚が出るまでが遅いと、人は「固まった」と思う（PRD §2）。
    expect(firstUnitMs).toBeLessThan(5000);
  }, 90000);

  describe('実機の映像から、復号の材料が取れる', () => {
    /**
     * **ここが抜けていたせいで、実機だけで真っ黒になった。**
     * codec を決め打ちにしていて、端末が名乗る level と食い違っていた。
     * 端末が実際に吐くものから取れることを、実機の検査で押さえる。
     */
    it('端末が名乗った codec を、流れてくるものから組み立てられる', async () => {
      const session = await createAndroidAdapter({
        build,
        ...target,
        liveView: { mode: 'h264-stream' },
      }).connect();
      try {
        await session.liveView.open();

        let bytes = new Uint8Array();
        for await (const chunk of session.liveView.frames?.() ?? []) {
          const next = new Uint8Array(bytes.length + chunk.length);
          next.set(bytes);
          next.set(chunk, bytes.length);
          bytes = next;
          if (bytes.length > 8000) break;
        }

        const codec = codecFromAnnexB(bytes);
        // 形は avc1.PPCCLL。**決め打ちの値と一致するとは限らない**のが、この検査の要点。
        expect(codec).toMatch(/^avc1\.[0-9a-f]{6}$/);
      } finally {
        await session.liveView.close();
        await session.close();
      }
    }, 30_000);

    it('端末の実寸が読める（人が触った座標を戻すのに要る）', async () => {
      const session = await createAndroidAdapter({ build, ...target }).connect();
      try {
        const size = await session.screenSize?.();

        expect(size?.width).toBeGreaterThan(0);
        expect(size?.height).toBeGreaterThan(0);
      } finally {
        await session.close();
      }
    }, 30_000);
  });
});
