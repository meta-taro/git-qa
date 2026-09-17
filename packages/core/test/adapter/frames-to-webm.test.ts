import { describe, expect, it } from 'vitest';

import { framesToWebmCommand } from '../../src/adapter/frames-to-webm.js';

/**
 * **1 枚ずつの絵を、動画にする**（meta-taro/git-qa#31）。
 *
 * > 全自動でテスト動画をとる場合、エージェントの操作は必須となります。
 *
 * ウェブと Windows には**録画が無い。**どちらも**ライブ映像は 1 枚ずつの絵**で
 * 流れているので、**同じ絵を溜めて繋げば動画になる。**
 *
 * **道具が無いことを理由に止めない**（`to-webm.ts` と同じ考え方）。
 * ffmpeg が無ければ**動画は作らない** —— **絵は残す。**
 */
describe('framesToWebmCommand', () => {
  it('溜めた絵を、並び順で繋ぐ', () => {
    const command = framesToWebmCommand(
      { ffmpeg: '/usr/bin/ffmpeg' },
      '/runs/case-001/frames/%05d.jpg',
      '/runs/case-001/screen.webm',
      8,
    );

    expect(command?.command).toBe('/usr/bin/ffmpeg');
    expect(command?.args).toContain('/runs/case-001/frames/%05d.jpg');
    // **並びの速さを渡す。**渡さないと、ffmpeg は 25 枚/秒として繋ぐ（実際より速く見える）。
    expect(command?.args.join(' ')).toContain('-framerate 8');
  });

  /** **VP9 を選ぶ**（`to-webm.ts` と同じ。同じ時間で 3.7 倍小さい）。 */
  it('webm（VP9）で書く', () => {
    const command = framesToWebmCommand({ ffmpeg: 'ffmpeg' }, 'in/%05d.jpg', 'out.webm', 8);

    expect(command?.args).toContain('libvpx-vp9');
  });

  /** **道具が無ければ作らない。**止めない（絵は残る）。 */
  it('ffmpeg が無ければ、何も返さない', () => {
    expect(framesToWebmCommand({}, 'in/%05d.jpg', 'out.webm', 8)).toBeUndefined();
  });

  /** **速さが分からないときは当てにいかない。**既定の 8 枚/秒に落とす。 */
  it('速さが読めなければ、既定に落とす', () => {
    const command = framesToWebmCommand({ ffmpeg: 'ffmpeg' }, 'in/%05d.jpg', 'out.webm', 0);

    expect(command?.args.join(' ')).toContain('-framerate 8');
  });
});
