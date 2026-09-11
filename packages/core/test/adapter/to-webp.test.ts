import { describe, expect, it } from 'vitest';

import { webpCommand } from '../../src/adapter/to-webp.js';

/**
 * **証跡の絵を webp で残す**（2026-09-11・人の指示）。
 *
 * > webp で出力したい。動画も理想は webm です。
 *
 * ウェブはブラウザがそのまま出せる（CDP が `webp` を受ける）。
 * **デスクトップと Android は変換が要る**が、macOS の `sips` は webp を**書けない**
 * （`sips --formats` に `Writable` が付いていない・実測）。外の道具が要る。
 *
 * **入っていないことを理由に止めない。**入っていなければ、撮れた形のまま置く。
 * **いちばん避けたいのは `.webp` という名前で JPEG を置くこと**
 * （同日、`png` と名乗って JPEG を渡していたのを直したばかり）。
 */
describe('webpCommand', () => {
  it('cwebp があれば、それを使う', () => {
    const cmd = webpCommand({ cwebp: '/opt/homebrew/bin/cwebp' }, 'in.jpg', 'out.webp');

    expect(cmd?.command).toBe('/opt/homebrew/bin/cwebp');
    expect(cmd?.args).toContain('in.jpg');
    expect(cmd?.args).toContain('out.webp');
  });

  /** 片方しか無い環境もある。**両方見る。** */
  it('cwebp が無ければ ffmpeg を使う', () => {
    const cmd = webpCommand({ ffmpeg: '/opt/homebrew/bin/ffmpeg' }, 'in.jpg', 'out.webp');

    expect(cmd?.command).toBe('/opt/homebrew/bin/ffmpeg');
    expect(cmd?.args).toContain('out.webp');
    // **黙って上書きしない**ようにしておく（-y を付けない＝既にあるなら止まる）。
    expect(cmd?.args).not.toContain('-y');
  });

  it('cwebp を先に選ぶ（webp 専用の道具なので）', () => {
    const cmd = webpCommand({ cwebp: '/a/cwebp', ffmpeg: '/a/ffmpeg' }, 'in.jpg', 'out.webp');

    expect(cmd?.command).toBe('/a/cwebp');
  });

  /** **無ければ undefined。**呼び側は、撮れた形のまま置く。 */
  it('どちらも無ければ、変換しない', () => {
    expect(webpCommand({}, 'in.jpg', 'out.webp')).toBeUndefined();
  });
});
