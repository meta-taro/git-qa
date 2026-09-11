/**
 * 証跡の絵を webp にする（2026-09-11・人の指示）。
 *
 * > webp で出力したい。動画も理想は webm です。
 *
 * ウェブはブラウザがそのまま出せる（CDP が `webp` を受ける）。
 * **デスクトップと Android は変換が要る。**macOS の `sips` は webp を**書けない**
 * （`sips --formats` に `Writable` が付いていない・実測）。**外の道具が要る。**
 *
 * **入っていないことを理由に止めない。**無ければ、撮れた形のまま置く。
 * **いちばん避けたいのは `.webp` という名前で JPEG を置くこと。**
 * 同じ日に、`png` と名乗って JPEG を渡していたのを直したばかり。
 *
 * 効き目（実測・1100x720 の画面）: `jpg 96,211 bytes → webp 10,086 bytes`。
 * 証跡はケースごとに積むので、ここは効く。
 */

/** 見つかった道具の場所。**無いものは持たない。** */
export interface ImageTools {
  readonly cwebp?: string;
  readonly ffmpeg?: string;
}

export interface ToolCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * webp にする道具と引数を決める。**どちらも無ければ `undefined`。**
 *
 * `cwebp` を先に選ぶ —— webp 専用の道具で、引数が少なく、失敗の仕方も読みやすい。
 * どちらも**黙って上書きしない**（`ffmpeg` に `-y` を付けない）。
 * 上書きが要る場面は無く、付けると**前の証跡を静かに消せてしまう。**
 */
export function webpCommand(
  tools: ImageTools,
  input: string,
  output: string,
): ToolCommand | undefined {
  if (tools.cwebp !== undefined) {
    // `-quiet` は成功時だけ黙る。失敗は出る。
    return { command: tools.cwebp, args: ['-quiet', '-q', '80', input, '-o', output] };
  }
  if (tools.ffmpeg !== undefined) {
    return { command: tools.ffmpeg, args: ['-loglevel', 'error', '-i', input, output] };
  }
  return undefined;
}
