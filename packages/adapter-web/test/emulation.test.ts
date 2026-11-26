import { describe, expect, it } from 'vitest';

import { deviceMetricsParams } from '../src/emulation.js';

/**
 * **表示領域の大きさを、窓ではなく Emulation で合わせる**（2026-11-26・C122）。
 *
 * `--window-size=390,844` では 390 にならない —— ブラウザの窓には最小幅があり、
 * 500 前後で止まる。`Emulation.setDeviceMetricsOverride` は窓の大きさと無関係に
 * ページの表示領域を決めるので、スマホ幅でも無人（`--no-ui`）でも同じに見える。
 */
describe('deviceMetricsParams', () => {
  it('幅と高さをそのまま渡し、拡大率は 1', () => {
    expect(deviceMetricsParams({ width: 390, height: 844 })).toEqual({
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
  });
});
