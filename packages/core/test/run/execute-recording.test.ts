import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type ExecuteRunOptions,
  type RecordingControl,
  type SheetRef,
  createFakeAdapter,
  executeRun,
  parseTestSpecTsv,
} from '../../src/index.js';

/**
 * **録るものを、外から差し替えられるようにする**（2026-09-11・人の判断）。
 *
 * > 録画ですが、git-qa を最大化して、そのアプリを録画するとどうですか？
 *
 * アダプタが持っている録画は**相手のアプリ**を録る。
 * 人が見たいのは **git-qa の窓**（ライブ映像・判定・AI の言い分・矢印が全部入る）。
 * **相手を録る口を消さない。**Android では相手を録るのが正しい。
 */

const SHEET_TEXT = [
  '#! md-business:test-spec-tsv/v1',
  '# タイトル: サンプル 検証シート',
  '# 文書番号: TEST-git-qa-001',
  'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
  '1\t起動する\t1. 開く\tホーム画面が出る',
  '2\t保存できる\t1. 保存する\t一覧に出る',
].join('\r\n');

const sheetRef = (): SheetRef => ({
  path: 'docs/test-specs/001.tsv',
  sha256: createHash('sha256').update(SHEET_TEXT).digest('hex'),
});

const options = (overrides: Partial<ExecuteRunOptions> = {}): ExecuteRunOptions => ({
  runId: '20260911-190000',
  sheet: parseTestSpecTsv(SHEET_TEXT),
  sheetRef: sheetRef(),
  adapter: createFakeAdapter({ recording: { requested: false } }),
  operator: { handle: 'octocat' },
  mode: 'auto',
  runCase: () => Promise.resolve({ aiResult: 'PASS' as const }),
  ...overrides,
});

/** 呼ばれた順を覚えるだけの録画。 */
const spyRecording = (): RecordingControl & { readonly calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    requested: true,
    start(caseNo: number) {
      calls.push(`start:${String(caseNo)}`);
      return Promise.resolve();
    },
    stop() {
      calls.push('stop');
      return Promise.resolve({
        state: 'recorded' as const,
        file: 'case-001/screen.webm',
        durationMs: 1000,
      });
    },
  };
};

describe('executeRun — 録るものを差し替える', () => {
  it('差し替えたほうが呼ばれる（アダプタのは呼ばれない）', async () => {
    const recording = spyRecording();

    const run = await executeRun(options({ recording }));

    expect(recording.calls).toEqual(['start:1', 'stop', 'start:2', 'stop']);
    expect(run.cases[0]?.recording).toEqual({
      state: 'recorded',
      file: 'case-001/screen.webm',
      durationMs: 1000,
    });
  });

  /** **証跡の「録画を頼んだか」も、差し替えたほうに合わせる。**食い違うと読めない。 */
  it('頼んだかどうかも、差し替えたほうを見る', async () => {
    const run = await executeRun(options({ recording: spyRecording() }));

    expect(run.recording).toEqual({ requested: true });
  });

  /** 差し替えなければ、**これまでどおりアダプタのものを使う。** */
  it('差し替えなければ、アダプタのものを使う', async () => {
    const run = await executeRun(options());

    expect(run.recording).toEqual({ requested: false });
    expect(run.cases[0]?.recording).toEqual({ state: 'not_requested' });
  });
});
