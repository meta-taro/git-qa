import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { saveAsWebm } from '../../src/run/video-webm.js';

/**
 * 撮れた `.mov` を webm にして置く（2026-09-11・人の指示）。
 *
 * **名前と中身を食い違わせない。**変換できなかったのに `.webm` を置くと、
 * 開けない証跡を「webm がある」と言うことになる。
 */
describe('saveAsWebm', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-qa-webm-'));
    await writeFile(join(dir, 'screen.mov'), 'もとの動画');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('道具があれば webm にして、元の形は残さない', async () => {
    const saved = await saveAsWebm({
      dir,
      name: 'screen.mov',
      tools: { ffmpeg: 'ffmpeg' },
      run: async (_c, args) => {
        // 変換できたことにする（最後の引数が出力先）。
        await writeFile(args[args.length - 1] ?? '', 'webm になった');
      },
    });

    expect(saved).toEqual({ name: 'screen.webm' });
    expect(await readFile(join(dir, 'screen.webm'), 'utf8')).toBe('webm になった');
    await expect(readFile(join(dir, 'screen.mov'))).rejects.toThrow();
  });

  /** **道具が無いのは失敗ではない。**動画は残っている。 */
  it('道具が無ければ、撮れた形のまま置く', async () => {
    const saved = await saveAsWebm({
      dir,
      name: 'screen.mov',
      tools: {},
      run: () => Promise.resolve(),
    });

    expect(saved).toEqual({ name: 'screen.mov' });
    expect(await readFile(join(dir, 'screen.mov'), 'utf8')).toBe('もとの動画');
  });

  /** **黙らない。**変換に失敗したことは、証跡に書く。 */
  it('変換に失敗したら、理由ごと元の形を残す', async () => {
    const saved = await saveAsWebm({
      dir,
      name: 'screen.mov',
      tools: { ffmpeg: 'ffmpeg' },
      run: () => Promise.reject(new Error('ffmpeg が落ちた')),
    });

    expect(saved.name).toBe('screen.mov');
    expect(saved.note).toContain('ffmpeg が落ちた');
    expect(await readFile(join(dir, 'screen.mov'), 'utf8')).toBe('もとの動画');
  });

  /** **道具が何も言わずに何も作らないことがある。**そのとき `.webm` を名乗らない。 */
  it('道具が成功と言っても、出来ていなければ名乗らない', async () => {
    const saved = await saveAsWebm({
      dir,
      name: 'screen.mov',
      tools: { ffmpeg: 'ffmpeg' },
      run: () => Promise.resolve(),
    });

    expect(saved.name).toBe('screen.mov');
    expect(saved.note).toContain('webm');
  });
});
