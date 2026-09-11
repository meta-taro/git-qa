import { describe, expect, it } from 'vitest';

import { pickImageTools } from '../src/image-tools.js';

/**
 * webp にする道具を探す（2026-09-11）。
 *
 * **入っていないことを理由に止めない。**無ければ、撮れた形のまま置く。
 * **こちらから入れさせない** —— §12 の「依存を足すときは確認する」に従い、
 * 前提を増やさず、**在れば使う**形にする。
 */
describe('pickImageTools', () => {
  it('見つかったものだけを持つ', () => {
    const tools = pickImageTools((name) =>
      name === 'cwebp' ? '/opt/homebrew/bin/cwebp' : undefined,
    );

    expect(tools).toEqual({ cwebp: '/opt/homebrew/bin/cwebp' });
  });

  it('両方あれば両方持つ', () => {
    const tools = pickImageTools((name) => `/x/${name}`);

    expect(tools).toEqual({ cwebp: '/x/cwebp', ffmpeg: '/x/ffmpeg' });
  });

  /** **無いものを持たない。**空のキーを置くと、在ると勘違いされる。 */
  it('どちらも無ければ空', () => {
    expect(pickImageTools(() => undefined)).toEqual({});
  });
});
