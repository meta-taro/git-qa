/**
 * **表示領域の大きさを、窓ではなく Emulation で合わせる**（2026-11-26・C122）。
 *
 * `--window-size=390,844` では 390 にならない —— ブラウザの窓には最小幅があり、
 * 500 前後で止まる。`Emulation.setDeviceMetricsOverride` は窓の大きさと無関係に
 * ページの表示領域（`window.innerWidth` / CSS のメディアクエリが見る幅）を決める。
 * 絵（`Page.captureScreenshot`・screencast）もその大きさで出る。
 */

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * `Emulation.setDeviceMetricsOverride` に渡すもの。
 *
 * - `deviceScaleFactor: 1` —— 絵の画素と CSS 画素を同じにする。人が映像を押した所の換算が要らない
 * - `mobile: false` —— スマホの UA や触れ方の真似はしない。**見ているのは幅による崩れ**で、
 *   端末の真似は実機（iOS / Android のアダプタ）の仕事
 */
export function deviceMetricsParams(viewport: ViewportSize): {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
} {
  return { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false };
}
