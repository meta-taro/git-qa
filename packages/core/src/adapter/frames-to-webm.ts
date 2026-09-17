import type { ImageTools, ToolCommand } from './to-webp.js';

/**
 * **1 枚ずつの絵を、動画にする**（外部レビュー meta-taro/git-qa#31）。
 *
 * ウェブと Windows には録画が無い。どちらも**ライブ映像は 1 枚ずつの絵**で流れているので、
 * **同じ絵を溜めて繋げば動画になる** —— しかも**人が見ていたものと同じ絵**が残る。
 *
 * **道具が無いことを理由に止めない**（`to-webm.ts` と同じ）。
 * ffmpeg が無ければ動画は作らない。**絵は残す。**
 */

/** 速さが読めないときの既定（ライブ映像の枚数と同じ）。 */
const DEFAULT_FPS = 8;

export function framesToWebmCommand(
  tools: ImageTools,
  pattern: string,
  output: string,
  fps: number,
): ToolCommand | undefined {
  if (tools.ffmpeg === undefined) return undefined;

  // **当てにいかない。**読めない速さで繋ぐと、実際より速い（遅い）動画になる。
  const rate = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : DEFAULT_FPS;

  return {
    command: tools.ffmpeg,
    args: [
      '-loglevel',
      'error',
      // **並びの速さは入力側に渡す。**出力側だけに渡すと、枚数が間引かれる。
      '-framerate',
      String(rate),
      '-i',
      pattern,
      '-c:v',
      'libvpx-vp9',
      '-crf',
      '34',
      '-b:v',
      '0',
      // 偶数でない大きさの絵でも通るようにする。
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-pix_fmt',
      'yuv420p',
      '-y',
      output,
    ],
  };
}
