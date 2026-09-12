import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initWorkspace } from '../src/workspace-init.js';

/**
 * **試験 1 本ぶんの家を作る**（2026-09-12・人の指示）。
 *
 * > 試験 tsv 画像動画がひとつのワークスペースにまとまっているみたいな。
 * > そっちの方が試験単位の git 管理も便利です
 *
 * **人のフォルダへ勝手にファイルを作らない。**作るのは、人が作れと言ったときだけ。
 */

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'git-qa-ws-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('initWorkspace', () => {
  it('印を置く', async () => {
    const path = await initWorkspace(dir);

    expect(path).toBe(join(dir, 'git-qa.json'));
    const marker = JSON.parse(await readFile(path, 'utf8')) as { schemaVersion: string };
    expect(marker.schemaVersion).toBe('git-qa/workspace/v1');
  });

  /** **既にある印を上書きしない。**中に書いた設定を黙って消さない。 */
  it('既にあるなら、触らない', async () => {
    await writeFile(join(dir, 'git-qa.json'), '{"これは":"人が書いたもの"}', 'utf8');

    await expect(initWorkspace(dir)).rejects.toThrow('既に');
    expect(await readFile(join(dir, 'git-qa.json'), 'utf8')).toContain('人が書いたもの');
  });

  /** 名前を付けられる（無ければフォルダ名）。 */
  it('名前を書き込む', async () => {
    const marker = JSON.parse(await readFile(await initWorkspace(dir, '連絡先の検証'), 'utf8')) as {
      title: string;
    };

    expect(marker.title).toBe('連絡先の検証');
  });
});
