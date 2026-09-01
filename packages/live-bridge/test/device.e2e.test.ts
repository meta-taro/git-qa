import { describe, expect, it } from 'vitest';

import { createAnnexBSplitter } from '@git-qa/core';
import { createAndroidAdapter } from '@git-qa/adapter-android';

import { startLiveBridge } from '../src/index.js';

/**
 * **端末 → アダプタ → 橋 → 受け手** が一本で繋がるか。
 *
 * 片方ずつは通っていても、繋いだ途端に映らないことがある。ここは全部本物を通す
 * （adb・HTTP・実際の端末）。既定では走らない（product-baseline §4）。
 *
 *   adb devices で端末が見えている状態で:
 *   GIT_QA_ANDROID_E2E=1 pnpm test:run
 */
const enabled = process.env['GIT_QA_ANDROID_E2E'] === '1';

describe.skipIf(!enabled)('端末から画面まで通す（adb が要る）', () => {
  it('端末の映像が、橋を通って枚として届く', async () => {
    const session = await createAndroidAdapter({
      build: { source: 'example/sample-notes-app', label: 'e2e' },
      liveView: { mode: 'h264-stream', timeLimitSec: 30 },
    }).connect();
    await session.liveView.open();

    const liveView = session.liveView;
    if (liveView.frames === undefined) {
      // h264-stream の方式なら必ずある。無いなら繋ぎ方を間違えているので、空で誤魔化さない。
      throw new Error('映像を読む口が無い（h264-stream で開いていない）');
    }
    const frames = liveView.frames.bind(liveView);
    const bridge = await startLiveBridge({ source: frames });

    // 画面が変化しないとフレームが出ない。読みながら操作を流す。
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
    let firstUnitMs: number | undefined;
    let bytes = 0;
    const units: { isKey: boolean }[] = [];

    try {
      const response = await fetch(bridge.url);
      expect(response.ok).toBe(true);
      const body: ReadableStream<Uint8Array> | null = response.body;
      expect(body).not.toBeNull();
      const reader = body!.getReader();

      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        for (const unit of splitter.push(next.value)) {
          firstUnitMs ??= Date.now() - startedAt;
          units.push(unit);
        }
        if (units.length >= 20) break;
      }
      await reader.cancel();
    } finally {
      stirring = false;
      await stir;
      await bridge.close();
      await session.liveView.close();
      await session.close();
    }

    console.log(
      `[端末→橋] ${String(bytes)} バイト / ${String(units.length)} 枚 / ` +
        `最初の 1 枚まで ${String(firstUnitMs)} ms`,
    );

    expect(units.length).toBeGreaterThanOrEqual(20);
    expect(units.some((u) => u.isKey)).toBe(true);
  }, 90000);
});
