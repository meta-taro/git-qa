import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type CaseContext,
  type CaseVerdict,
  type HumanVerdict,
  type Run,
  createFakeAdapter,
  executeRun,
  parseTestSpecTsv,
  validateRun,
  writeRunJson,
} from '../../src/index.js';

/**
 * 検証シートを読む → 走らせる → `run.json` をディスクへ出す、までを 1 本通す。
 *
 * **Fake アダプタに繋いでいるので、これは「Android で動く」ことの確認ではない。**
 * 確かめているのは、この道具の芯（人が見た行と見ていない行が、証跡として区別できること）が
 * 端から端まで繋がっていることだけ。
 */

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-notes-app.tsv', import.meta.url));

let runsRoot = '';

beforeEach(async () => {
  runsRoot = await mkdtemp(join(tmpdir(), 'git-qa-e2e-'));
});

afterEach(async () => {
  await rm(runsRoot, { recursive: true, force: true });
});

/** 人が No.1 だけを見た実行を 1 本走らせて、書き出した run.json を読み返す。 */
const runOnce = async (runId: string, recordingRequested: boolean): Promise<Run> => {
  const text = await readFile(FIXTURE, 'utf8');
  const sheet = parseTestSpecTsv(text);

  const run = await executeRun({
    runId,
    sheet,
    sheetRef: {
      path: 'packages/core/test/fixtures/sample-notes-app.tsv',
      sha256: createHash('sha256').update(text).digest('hex'),
      ...(sheet.meta['タイトル'] === undefined ? {} : { title: sheet.meta['タイトル'] }),
    },
    adapter: createFakeAdapter({ kind: 'android', recording: { requested: recordingRequested } }),
    operator: { handle: 'octocat' },
    mode: 'assisted',
    runCase: (ctx: CaseContext): Promise<CaseVerdict> => {
      ctx.step(`${ctx.subject.title} を操作`);
      return Promise.resolve({ aiResult: 'PASS' });
    },
    askHuman: (ctx: CaseContext): Promise<HumanVerdict | undefined> =>
      Promise.resolve(
        ctx.subject.no === 1 ? { humanResult: 'VERIFIED', by: 'octocat' } : undefined,
      ),
  });

  const path = await writeRunJson(runsRoot, run);
  return JSON.parse(await readFile(path, 'utf8')) as Run;
};

describe('シートを読んで走らせ、run.json を出すまで', () => {
  it('シートの 5 行が、人が見た 1 行と見ていない 4 行として残る', async () => {
    const run = await runOnce('20260817-144500', true);

    expect(validateRun(run).valid).toBe(true);
    expect(run.cases).toHaveLength(5);
    expect(run.cases.map((c) => c.result)).toEqual([
      'VERIFIED',
      'AUTO_PASS',
      'AUTO_PASS',
      'AUTO_PASS',
      'AUTO_PASS',
    ]);
    // AI は 5 件とも通している。**それでも「保証された」のは 1 件だけ**と読める。
    expect(run.cases.every((c) => c.aiResult === 'PASS')).toBe(true);
    expect(run.cases.filter((c) => c.verifiedBy !== undefined)).toHaveLength(1);
  });

  it('録画ありと録画なしを走らせると、証跡の上で区別がつく（Issue 006）', async () => {
    const withVideo = await runOnce('20260817-recorded', true);
    const without = await runOnce('20260817-norecord', false);

    expect(withVideo.recording.requested).toBe(true);
    expect(without.recording.requested).toBe(false);
    expect(withVideo.cases.map((c) => c.recording.state)).toEqual(Array(5).fill('recorded'));
    expect(without.cases.map((c) => c.recording.state)).toEqual(Array(5).fill('not_requested'));

    const first = withVideo.cases[0]?.recording;
    expect(first).toMatchObject({ state: 'recorded', file: 'case-001/screen.mp4' });
  });
});
