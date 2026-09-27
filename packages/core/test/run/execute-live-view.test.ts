import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type ExecuteRunOptions,
  type LiveViewEvent,
  createFakeAdapter,
  executeRun,
  parseTestSpecTsv,
  validateRun,
} from '../../src/index.js';

/**
 * **映像が離れた／戻った時刻を、証跡に残す**（meta-taro/git-qa#33）。
 *
 * 画面の文言は消える。**その場に居なかった人が、あとで読めること。**
 */

const SHEET_TEXT = [
  '#! md-business:test-spec-tsv/v1',
  '# タイトル: 映像の記録',
  'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
  '1\t開く\t1. 開く\t出る',
].join('\r\n');

const options = (overrides: Partial<ExecuteRunOptions> = {}): ExecuteRunOptions => ({
  runId: '20260927-091200',
  sheet: parseTestSpecTsv(SHEET_TEXT),
  sheetRef: {
    path: 'docs/test-specs/live.tsv',
    sha256: createHash('sha256').update(SHEET_TEXT).digest('hex'),
  },
  adapter: createFakeAdapter(),
  operator: { handle: 'octocat' },
  mode: 'auto',
  runCase: () => Promise.resolve({ aiResult: 'PASS' as const }),
  ...overrides,
});

describe('executeRun — 映像の記録', () => {
  it('渡された記録を、そのまま証跡に入れる（形も通る）', async () => {
    const events: LiveViewEvent[] = [
      { at: '2026-09-27T09:12:03.120Z', kind: 'left' },
      { at: '2026-09-27T09:12:04.220Z', kind: 'joined' },
    ];

    const run = await executeRun(options({ liveView: () => events }));

    expect(run.liveView).toEqual(events);
    expect(validateRun(run)).toEqual({ valid: true, errors: [] });
  });

  /** 画面を持たない実行（`--no-ui`）では何も渡らない。**空の欄を書かない。** */
  it('渡されなければ、欄を作らない', async () => {
    const run = await executeRun(options());

    expect(run).not.toHaveProperty('liveView');
    expect(validateRun(run)).toEqual({ valid: true, errors: [] });
  });

  /** **語を増やさない。**「切断」は配る側からは言えない（網か、閉じたのかを区別できない）。 */
  it('知らない語の記録は、形の検査で落ちる', async () => {
    const run = await executeRun(options());
    const bad = { ...run, liveView: [{ at: '2026-09-27T09:12:03.120Z', kind: 'disconnected' }] };

    const result = validateRun(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('/liveView/0/kind');
  });
});
