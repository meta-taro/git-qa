import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Run, runJsonPath, validateRun, writeRunJson } from '../../src/index.js';
import { validRun } from './fixtures.js';

let runsRoot = '';

beforeEach(async () => {
  runsRoot = await mkdtemp(join(tmpdir(), 'git-qa-runs-'));
});

afterEach(async () => {
  await rm(runsRoot, { recursive: true, force: true });
});

const readBack = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;

describe('writeRunJson — 証跡をディスクに出す', () => {
  it('runs/<runId>/run.json に書き、書いた場所を返す', async () => {
    const run = validRun();
    const path = await writeRunJson(runsRoot, run);
    expect(path).toBe(runJsonPath(runsRoot, run.runId));
    expect(await readBack(path)).toEqual(run);
  });

  it('書いたものはスキーマを通る', async () => {
    const path = await writeRunJson(runsRoot, validRun());
    expect(validateRun(await readBack(path)).valid).toBe(true);
  });

  it('スキーマを通らない実行は書かない', async () => {
    // 壊れた証跡をディスクへ出すと、後から「読めない run.json」だけが残る。
    const broken = { ...validRun(), runId: '../escape' } as Run;
    await expect(writeRunJson(runsRoot, broken)).rejects.toThrow(/runId/);
  });

  it('同じ runId に 2 度書かない', async () => {
    // 実行の証跡を黙って上書きすると、上書き前に何があったか誰も分からない。
    const run = validRun();
    await writeRunJson(runsRoot, run);
    await expect(writeRunJson(runsRoot, run)).rejects.toThrow(/既にある/);
  });
});
