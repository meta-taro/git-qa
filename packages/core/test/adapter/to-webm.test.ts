import { describe, expect, it } from 'vitest';

import { webmCommand } from '../../src/adapter/to-webm.js';

/**
 * 動画を webm にする（2026-09-11・人の指示）。
 *
 * > webp で出力したい。動画も理想は webm です。
 *
 * **効き目**（実測・1280x800 を 4.4 秒）: `mov 169,644 → webm 36,870 bytes`、
 * 変換に 1.0 秒。長い実行ほど効く。
 */
describe('webmCommand', () => {
  it('ffmpeg が要る。無ければ諦める', () => {
    expect(webmCommand({}, 'a.mov', 'a.webm')).toBeUndefined();
  });

  it('ffmpeg があれば、それで変換する', () => {
    const command = webmCommand({ ffmpeg: '/opt/homebrew/bin/ffmpeg' }, 'a.mov', 'a.webm');

    expect(command?.command).toBe('/opt/homebrew/bin/ffmpeg');
    expect(command?.args).toContain('a.mov');
    expect(command?.args).toContain('a.webm');
  });

  /** **前の証跡を黙って消さない**（絵のときと同じ・`-y` を付けない）。 */
  it('黙って上書きしない', () => {
    expect(webmCommand({ ffmpeg: 'ffmpeg' }, 'a.mov', 'a.webm')?.args).not.toContain('-y');
  });

  /** cwebp は絵の道具。**動画には効かない**ので、これを見て「変換できる」と思わない。 */
  it('cwebp しか無いのは、無いのと同じ', () => {
    expect(webmCommand({ cwebp: '/opt/homebrew/bin/cwebp' }, 'a.mov', 'a.webm')).toBeUndefined();
  });
});
