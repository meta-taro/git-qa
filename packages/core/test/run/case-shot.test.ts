import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { captureCaseShot } from '../../src/run/case-shot.js';
import type { Screenshot, TargetSession } from '../../src/adapter/types.js';

/**
 * **判定を置く時点の画面を残す**（2026-09-11・人の指示）。
 *
 * > 人はぼーっとみながら AI のテストを鑑賞します。
 * > そのときに AI がわは、テスト判定のキャプチャと、動画をとっていきます。
 *
 * それまで、証跡フォルダには `run.json` しか無かった（実測。10 件の実行すべて）。
 * **「あとで見直す」と言っていた材料が、1 枚も残っていなかった。**
 *
 * **撮れなかったときは、撮らなかったのか失敗したのかを分ける。**黙って空にしない。
 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const made: string[] = [];
const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'git-qa-shot-'));
  made.push(dir);
  return dir;
};
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

const sessionWith = (shot: () => Promise<Screenshot>): Pick<TargetSession, 'screenshot'> => ({
  screenshot: shot,
});

describe('captureCaseShot', () => {
  it('撮れたら、ケースのフォルダへ置いて、場所を返す', async () => {
    const root = await tempDir();
    const result = await captureCaseShot({
      session: sessionWith(() =>
        Promise.resolve({
          format: 'png' as const,
          bytes: PNG,
          capturedAt: '2026-09-11T12:00:00.000Z',
        }),
      ),
      runsRoot: root,
      runId: '20260911-120000',
      caseNo: 3,
    });

    expect(result).toEqual({ state: 'saved', file: 'case-003/screen.png' });
    const written = await readFile(join(root, '20260911-120000', 'case-003', 'screen.png'));
    expect(new Uint8Array(written)).toEqual(PNG);
  });

  /** **置き場所が無いなら、撮らない。**失敗ではない。 */
  it('置き場所が無ければ、撮っていないと言う', async () => {
    const result = await captureCaseShot({
      session: sessionWith(() =>
        Promise.resolve({
          format: 'png' as const,
          bytes: PNG,
          capturedAt: '2026-09-11T12:00:00.000Z',
        }),
      ),
      runId: 'r',
      caseNo: 1,
    });

    expect(result).toEqual({ state: 'not_requested' });
  });

  /** **失敗を握り潰さない。**理由を残す（撮れなかったことと、撮らなかったことは別）。 */
  it('撮れなかったら、理由を残す', async () => {
    const root = await tempDir();
    const result = await captureCaseShot({
      session: sessionWith(() => Promise.reject(new Error('端末が居ない'))),
      runsRoot: root,
      runId: 'r',
      caseNo: 1,
    });

    // **型で絞ってから読む。**`saved` に `reason` は無い（union で持てなくしてある）。
    expect(result.state).toBe('failed');
    if (result.state !== 'failed') throw new Error('failed のはず');
    expect(result.reason).toContain('端末が居ない');
  });

  /** 撮る口を持たないアダプタもあり得る。**失敗とは別に言う。** */
  it('撮る口が無ければ、持っていないと言う', async () => {
    const root = await tempDir();
    const result = await captureCaseShot({ session: {}, runsRoot: root, runId: 'r', caseNo: 1 });

    expect(result.state).toBe('unsupported');
    if (result.state !== 'unsupported') throw new Error('unsupported のはず');
    expect(result.reason).toContain('撮る');
  });
});
