import type { ImageTools, ToolCommand } from './to-webp.js';

/**
 * 証跡の動画を webm にする（2026-09-11・人の指示）。
 *
 * > webp で出力したい。動画も理想は webm です。
 *
 * 撮るのは macOS の ScreenCaptureKit で、**出てくるのは H.264 の `.mov`。**
 * webm にするには外の道具（ffmpeg）が要る。
 *
 * **効き目**（実測・1280x800 を 4.4 秒）:
 *
 * ```
 * mov 169,644 bytes → webm(VP9) 36,870 bytes   変換 1.0 秒
 *                   → webm(VP8) 136,732 bytes  変換 1.0 秒
 * ```
 *
 * **VP9 を選ぶ。**同じ時間で 3.7 倍小さい。
 *
 * **入っていないことを理由に止めない。**無ければ `.mov` のまま置く。
 * **`.webm` という名前で mov を置くことだけはしない**（絵のときと同じ）。
 */

/** webm にする道具と引数を決める。**ffmpeg が無ければ `undefined`。** */
export function webmCommand(
  tools: ImageTools,
  input: string,
  output: string,
): ToolCommand | undefined {
  if (tools.ffmpeg === undefined) return undefined;

  return {
    command: tools.ffmpeg,
    args: [
      '-loglevel',
      'error',
      '-i',
      input,
      '-c:v',
      'libvpx-vp9',
      // 画質は固定品質で決める（`-b:v 0` が「量ではなく質で決める」の意味）。
      '-crf',
      '34',
      '-b:v',
      '0',
      // 速さと大きさの釣り合い。0 だと数倍遅く、証跡としての値打ちは変わらない。
      '-cpu-used',
      '5',
      '-row-mt',
      '1',
      output,
    ],
  };
}
