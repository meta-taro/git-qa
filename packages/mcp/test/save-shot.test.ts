import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { saveShot } from '../src/save-shot.js';

/**
 * **撮った画面を、名前を付けて残す**（2026-10-20）。
 *
 * `device_screenshot` は絵を返すだけで、証跡にするには、AI の道具の一時フォルダから
 * 画像を探してコピーしていた。**置き場所と名前を渡せば、そのまま証跡のフォルダに入る。**
 */
const png = { mimeType: 'image/png' as const, base64: Buffer.from('png-bytes').toString('base64') };
const jpeg = { mimeType: 'image/jpeg' as const, base64: Buffer.from('jpg').toString('base64') };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'git-qa-save-shot-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('saveShot', () => {
  it('渡した場所へ、そのままの中身で書く（無いフォルダは作る）', async () => {
    const saved = await saveShot(png, join(dir, 'evidence', '01-設定.png'));
    expect(saved).toBe(join(dir, 'evidence', '01-設定.png'));
    expect((await readFile(saved)).toString()).toBe('png-bytes');
  });

  it('拡張子が無ければ、中身の形に合わせて付ける', async () => {
    const saved = await saveShot(jpeg, join(dir, 'shot'));
    expect(saved).toBe(join(dir, 'shot.jpg'));
  });

  it('相対の場所は、渡された基点から数える', async () => {
    const saved = await saveShot(png, 'runs/a.png', dir);
    expect(saved).toBe(join(dir, 'runs', 'a.png'));
  });

  /** 中身が JPEG なのに .png と名乗る証跡は、開いた人を誤らせる。 */
  it('拡張子が中身の形と違えば、書かずに断る', async () => {
    await expect(saveShot(jpeg, join(dir, 'a.png'))).rejects.toThrow(/\.jpg/);
  });

  /** 証跡を黙って上書きしない。 */
  it('もう在るファイルには書かずに断る', async () => {
    await writeFile(join(dir, 'a.png'), 'before');
    await expect(saveShot(png, join(dir, 'a.png'))).rejects.toThrow(/もう在る/);
    expect((await readFile(join(dir, 'a.png'))).toString()).toBe('before');
  });
});
