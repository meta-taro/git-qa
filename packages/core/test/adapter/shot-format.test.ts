import { describe, expect, it } from 'vitest';

import { mimeTypeOf } from '../../src/adapter/shot-format.js';

/**
 * **名乗った形と、中身を一致させる**（2026-09-11 に実物で見つけた）。
 *
 * 証跡に落とした 1 枚目を `file` で見たら、こうだった。
 *
 * ```
 * screen.png: JPEG image data, JFIF standard 1.01 … 1100x720
 * ```
 *
 * デスクトップのアダプタが `format: 'png'` と名乗っていたが、
 * 中身は `screencapture -t jpg` の JPEG。しかも MCP はそれを
 * **`mimeType: 'image/png'` として AI エージェントへ渡していた。**
 *
 * 外部レビュー #1 と同じ形 —— **書いてあるのに、そうなっていない。**
 */
describe('mimeTypeOf', () => {
  it('名乗った形から作る（決め打ちにしない）', () => {
    expect(mimeTypeOf('png')).toBe('image/png');
    expect(mimeTypeOf('jpg')).toBe('image/jpeg');
  });
});
