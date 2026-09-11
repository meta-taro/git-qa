import type { Screenshot } from './types.js';

/**
 * 撮った絵の形から、渡すときの名前を作る。
 *
 * **決め打ちにしない。**2026-09-11、デスクトップのアダプタが `format: 'png'` と
 * 名乗りながら JPEG を返していて、MCP がそれを `image/png` として
 * AI エージェントへ渡していた。**名乗りと中身を、1 か所で結ぶ。**
 */
export function mimeTypeOf(
  format: Screenshot['format'],
): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (format === 'jpg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}
