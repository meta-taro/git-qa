import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findUnfinishedRuns } from '../src/resume.js';

/**
 * **続きから走らせられる証跡を見つける**（2026-09-12・人の指示）。
 *
 * > それは途中までテストして、落として、次の日検証を再開しても大丈夫ですかね
 *
 * 目印は **`finishedAt` が無いこと。**「無いことが『途中で止まった』の記録になる」
 * という約束で作ってある（`types.ts`）。
 */

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'git-qa-resume-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const put = async (runId: string, run: Record<string, unknown>): Promise<void> => {
  await mkdir(join(root, runId), { recursive: true });
  await writeFile(join(root, runId, 'run.json'), JSON.stringify(run), 'utf8');
};

const base = (runId: string): Record<string, unknown> => ({
  schemaVersion: 'git-qa/run/v1',
  runId,
  startedAt: '2026-09-11T09:00:00.000Z',
  operator: { handle: 'octocat' },
  mode: 'assisted',
  sheet: { path: '検証.tsv', sha256: 'a'.repeat(64) },
  target: { kind: 'desktop', device: 'x' },
  recording: { requested: false },
  cases: [],
  findings: [],
});

describe('findUnfinishedRuns', () => {
  it('終わりの時刻が無いものを見つける', async () => {
    await put('20260911-090000', base('20260911-090000'));

    const found = await findUnfinishedRuns(root);

    expect(found.map((r) => r.runId)).toEqual(['20260911-090000']);
  });

  /** **走り切ったものは出さない。**続きが無い。 */
  it('走り切ったものは出さない', async () => {
    await put('20260911-090000', {
      ...base('20260911-090000'),
      finishedAt: '2026-09-11T10:00:00.000Z',
    });

    expect(await findUnfinishedRuns(root)).toEqual([]);
  });

  /** **新しいものが先。**人が探すのは、だいたい直前に止めたもの。 */
  it('新しい順に並べる', async () => {
    await put('20260910-090000', base('20260910-090000'));
    await put('20260911-090000', base('20260911-090000'));

    expect((await findUnfinishedRuns(root)).map((r) => r.runId)).toEqual([
      '20260911-090000',
      '20260910-090000',
    ]);
  });

  /** **どこまで見たかを出す。**人が選ぶときに、いちばん知りたいのがそこ。 */
  it('どこまで置いたかを添える', async () => {
    await put('20260911-090000', {
      ...base('20260911-090000'),
      cases: [
        {
          no: 1,
          title: 'あ',
          startedAt: 'x',
          result: 'VERIFIED',
          steps: [],
          recording: { state: 'not_requested' },
        },
        {
          no: 2,
          title: 'い',
          startedAt: 'x',
          result: 'AUTO_PASS',
          steps: [],
          recording: { state: 'not_requested' },
        },
      ],
    });

    const [found] = await findUnfinishedRuns(root);

    expect(found?.cases).toBe(2);
    // **人が見て置いたのは 1 件だけ。**`AUTO_PASS` は誰も見ていない。
    expect(found?.placed).toBe(1);
    expect(found?.sheetPath).toBe('検証.tsv');
  });

  /** **読めないものは黙って捨てる。**壊れた 1 つで、他の候補まで見せられなくならない。 */
  it('読めない run.json があっても、他は出す', async () => {
    await mkdir(join(root, 'こわれた'), { recursive: true });
    await writeFile(join(root, 'こわれた', 'run.json'), '{ これは JSON ではない', 'utf8');
    await put('20260911-090000', base('20260911-090000'));

    expect((await findUnfinishedRuns(root)).map((r) => r.runId)).toEqual(['20260911-090000']);
  });

  /** 置き場そのものが無いのは、**普通のこと**（まだ 1 度も走らせていない）。 */
  it('置き場が無ければ、空を返す', async () => {
    expect(await findUnfinishedRuns(join(root, 'まだ無い'))).toEqual([]);
  });
});
