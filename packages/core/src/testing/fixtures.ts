import { RUN_SCHEMA_VERSION } from '../index.js';
import type { Run } from '../index.js';

export const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
export const SHA256 = '0'.repeat(64);

/**
 * 最小限だが「実際に起こりうる」実行 1 回分。個々のテストはここから 1 箇所だけ崩す。
 *
 * 対象は架空のアプリ（サンプルメモ帳）。実在の案件・機体・担当は入れない。
 */
export const validRun = (): Run => ({
  schemaVersion: RUN_SCHEMA_VERSION,
  runId: '20260817-144530',
  startedAt: '2026-08-17T14:45:30.000Z',
  finishedAt: '2026-08-17T14:58:02.000Z',
  operator: { handle: 'octocat' },
  mode: 'assisted',
  sheet: {
    path: 'docs/test-specs/001-sample-notes-app.tsv',
    sha256: SHA256,
    title: 'サンプルメモ帳アプリ 検証シート',
    documentNumber: 'TEST-git-qa-001',
  },
  target: {
    kind: 'android',
    device: 'Pixel 7a',
    osVersion: '15',
    build: { source: 'example/sample-notes-app', commit: COMMIT, label: 'debug' },
  },
  recording: { requested: true },
  cases: [
    {
      no: 1,
      title: 'アプリが起動する',
      startedAt: '2026-08-17T14:45:31.000Z',
      finishedAt: '2026-08-17T14:45:52.000Z',
      aiResult: 'PASS',
      humanResult: 'VERIFIED',
      result: 'VERIFIED',
      verifiedBy: 'octocat',
      verifiedAt: '2026-08-17T14:45:52.000Z',
      steps: [{ index: 0, at: '2026-08-17T14:45:33.000Z', label: 'アプリアイコンをタップする' }],
      recording: { state: 'recorded', file: 'video.mp4', durationMs: 21000 },
    },
  ],
  findings: [],
});
