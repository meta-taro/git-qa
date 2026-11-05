import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseTestSpecTsv } from '@git-qa/core';

import { startRunSession } from '../src/index.js';
import { fakeBridge } from './fake-bridge.js';
import { fakeScreenPerCase } from './fake-screen.js';
import { stubAdapter } from './stub-adapter.js';

/**
 * **家の代わり。**`homedir()` を検査用の空のフォルダへ向ける（本物の書類フォルダへ書かない）。
 * `vi.mock` は巻き上げられるので、値は `vi.hoisted` の箱で渡す。
 */
const HOME = vi.hoisted(() => ({ dir: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => HOME.dir };
});

const SHEET = parseTestSpecTsv(
  [
    '#! md-business:test-spec-tsv/v1',
    'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
    '1\tメモを保存できる\t保存をタップする\t「保存しました」と表示される',
    '2\tメモを削除できる\t削除をタップする\t「保存しました」と表示される',
    '',
  ].join('\n'),
);

const RUN_ID = '20261105-150000';

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`待っても起きなかった: ${label}`);
}

/**
 * **置き場を渡されなかったときの既定**（#43）。
 *
 * Finder から `.app` を起動すると作業ディレクトリが `/` になる。配布版（beta.21）では
 * `run.json` だけが書類フォルダの下へ逃げ、**ケースの画面と途中経過は `/runs` へ書こうとして
 * 毎回失敗していた**（`mkdir '/runs'` で ENOENT）。失敗は証跡に残るだけで、画面には出ない。
 *
 * 既定も `run.json` と同じ逃がし方にする —— **1 本の実行の証跡は、1 つの場所に揃う。**
 */
describe('startRunSession — 証跡の置き場の既定', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('打った場所が / なら、ケースの画面も途中経過も書類フォルダの下の runs/ へ書く', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    HOME.dir = await mkdtemp(join(tmpdir(), 'git-qa-home-'));
    vi.stubEnv('INIT_CWD', '/');

    const bridge = fakeBridge();
    const session = await startRunSession({
      afterActionMs: 0,
      adapter: stubAdapter({}),
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: RUN_ID,
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
      expectation: { waitMs: 0, stepMs: 1 },
    });

    await waitFor(() => bridge.states.at(-1)?.awaiting === 1, '1 件目の打鍵待ち');
    bridge.send({ kind: 'verdict', caseNo: 1, humanResult: 'VERIFIED' });
    await waitFor(() => bridge.states.at(-1)?.awaiting === 2, '2 件目の打鍵待ち');
    session.abort('検査の後始末');
    const run = await session.done;
    await session.close();

    const runsRoot = join(HOME.dir, 'Documents', 'git-qa', 'runs');
    const shot = run.cases[0]?.screenshot;
    expect(shot?.state).toBe('saved');
    if (shot?.state !== 'saved') return;
    await expect(stat(join(runsRoot, RUN_ID, shot.file))).resolves.toBeDefined();
    // 途中経過（人が置いた判定）も同じ所に在る。落ちても判定が消えない。
    await expect(stat(join(runsRoot, RUN_ID, 'run.json'))).resolves.toBeDefined();
  });
});
