import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveAsWebp } from '../../src/run/shot-webp.js';

/**
 * **変換できたら webp、できなければ撮れた形のまま。**
 *
 * **名前と中身を食い違わせない。**変換に失敗したのに `.webp` を置くと、
 * 同じ日に直したばかりの嘘（`png` と名乗って JPEG）を、また作ることになる。
 */
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00]);

const made: string[] = [];
const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'git-qa-webp-'));
  made.push(dir);
  return dir;
};
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('saveAsWebp', () => {
  it('道具があれば webp で置く', async () => {
    const dir = await tempDir();
    const run = vi.fn(async (_c: string, args: readonly string[]) => {
      // 変換したふりをして、出力先へ webp らしきものを置く。
      await writeFile(args[args.length - 1] as string, WEBP);
    });

    const saved = await saveAsWebp({
      dir,
      bytes: JPG,
      format: 'jpg',
      tools: { cwebp: '/a/cwebp' },
      run,
    });

    expect(saved).toEqual({ name: 'screen.webp' });
    expect(new Uint8Array(await readFile(join(dir, 'screen.webp')))).toEqual(WEBP);
  });

  /** **道具が無ければ、撮れた形のまま。**失敗ではない。 */
  it('道具が無ければ、撮れた形のまま置く', async () => {
    const dir = await tempDir();

    const saved = await saveAsWebp({ dir, bytes: JPG, format: 'jpg', tools: {}, run: vi.fn() });

    expect(saved).toEqual({ name: 'screen.jpg' });
    expect(new Uint8Array(await readFile(join(dir, 'screen.jpg')))).toEqual(JPG);
  });

  /** **既に webp なら、触らない。**（ウェブは CDP がそのまま出す） */
  it('もう webp なら、変換しない', async () => {
    const dir = await tempDir();
    const run = vi.fn();

    const saved = await saveAsWebp({
      dir,
      bytes: WEBP,
      format: 'webp',
      tools: { cwebp: '/a/cwebp' },
      run,
    });

    expect(saved).toEqual({ name: 'screen.webp' });
    expect(run).not.toHaveBeenCalled();
  });

  /**
   * **変換に失敗したら、撮れた形のまま置く。**
   * `.webp` という名前で中身が違うものを置かない。
   */
  it('変換に失敗したら、撮れた形のまま置いて、理由を返す', async () => {
    const dir = await tempDir();
    const run = vi.fn(() => Promise.reject(new Error('cwebp が落ちた')));

    const saved = await saveAsWebp({
      dir,
      bytes: JPG,
      format: 'jpg',
      tools: { cwebp: '/a/cwebp' },
      run,
    });

    expect(saved.name).toBe('screen.jpg');
    expect(saved.note).toContain('cwebp が落ちた');
    expect(new Uint8Array(await readFile(join(dir, 'screen.jpg')))).toEqual(JPG);
  });
});
