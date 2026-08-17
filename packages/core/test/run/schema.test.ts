import { describe, expect, it } from 'vitest';

import {
  AI_RESULTS,
  CASE_RESULTS,
  HUMAN_RESULTS,
  RUN_SCHEMA,
  RUN_SCHEMA_VERSION,
  validateRun,
} from '../../src/index.js';
import type { Run } from '../../src/index.js';

const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SHA256 = '0'.repeat(64);

/** 最小限だが「実際に起こりうる」実行 1 回分。個々のテストはここから 1 箇所だけ崩す。 */
const validRun = (): Run => ({
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

const expectValid = (run: unknown): void => {
  const result = validateRun(run);
  expect(result.errors).toEqual([]);
  expect(result.valid).toBe(true);
};

const expectInvalid = (run: unknown, match: RegExp): void => {
  const result = validateRun(run);
  expect(result.valid).toBe(false);
  expect(result.errors.join('\n')).toMatch(match);
};

describe('run.json のスキーマ', () => {
  it('スキーマがファイルとして存在し、機械で検証できる形になっている', () => {
    expect(RUN_SCHEMA.$id).toContain('run');
    expect(RUN_SCHEMA.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('一通り埋まった実行が通る', () => {
    expectValid(validRun());
  });

  it('スキーマ版が違えば落ちる', () => {
    // 版が無いと、後から形を変えたときに古い run.json を読み違える。
    const run = { ...validRun(), schemaVersion: 'git-qa/run/v0' };
    expectInvalid(run, /schemaVersion/);
  });

  it('知らないキーが混ざっていたら落ちる', () => {
    // 綴り違いを黙って捨てると、「書いたのに残っていない」が起きる。
    const run = { ...validRun(), reslut: 'VERIFIED' };
    expectInvalid(run, /reslut/);
  });

  it('語彙にない結果は落ちる', () => {
    const run = validRun();
    run.cases[0]!.result = 'PASS' as never;
    expectInvalid(run, /result/);
  });
});

describe('run.json — VERIFIED と AUTO_PASS を別の値として出す（C1）', () => {
  it('VERIFIED には、名前を置いた人が要る', () => {
    const run = validRun();
    delete run.cases[0]!.verifiedBy;
    expectInvalid(run, /verifiedBy/);
  });

  it('AUTO_PASS に人の名前は付かない', () => {
    // 「誰も見ていない」ことの記録なので、名前が付いた時点で嘘になる。
    const run = validRun();
    delete run.cases[0]!.humanResult;
    run.cases[0]!.result = 'AUTO_PASS';
    expectInvalid(run, /verifiedBy/);
  });

  it('同じ実行の中に VERIFIED と AUTO_PASS が並んで出せる', () => {
    const run = validRun();
    const verified = run.cases[0]!;
    run.cases.push({
      no: 2,
      title: 'メモを保存できる',
      startedAt: '2026-08-17T14:46:00.000Z',
      finishedAt: '2026-08-17T14:46:20.000Z',
      aiResult: 'PASS',
      result: 'AUTO_PASS',
      steps: [],
      recording: { state: 'recorded', file: 'video.mp4', durationMs: 20000 },
    });
    expectValid(run);
    expect(verified.result).toBe('VERIFIED');
    expect(run.cases[1]?.result).toBe('AUTO_PASS');
  });
});

describe('run.json — 録画したかどうかを残す（C11）', () => {
  it('録画は実行開始時の設定として残る（モードには紐づかない）', () => {
    const run = validRun();
    run.mode = 'manual';
    run.recording = { requested: false };
    run.cases[0]!.recording = { state: 'not_requested' };
    expectValid(run);
  });

  it('動画が無いとき、録画オフと録画失敗が別の値として出る', () => {
    const off = validRun();
    off.recording = { requested: false };
    off.cases[0]!.recording = { state: 'not_requested' };
    expectValid(off);

    const failed = validRun();
    failed.cases[0]!.recording = { state: 'failed', reason: 'scrcpy が途中で落ちた' };
    expectValid(failed);

    expect(off.cases[0]?.recording.state).not.toBe(failed.cases[0]?.recording.state);
  });

  it('録画に失敗したのに理由が無ければ落ちる', () => {
    // 理由の無い「動画なし」は、後から証跡として読めない。
    const run = validRun();
    run.cases[0]!.recording = { state: 'failed' } as never;
    expectInvalid(run, /reason/);
  });

  it('アダプタが録画に対応していない場合も理由付きで残る', () => {
    const run = validRun();
    run.cases[0]!.recording = { state: 'unsupported', reason: 'このアダプタは録画に対応しない' };
    expectValid(run);
  });

  it('録画の記録そのものが無い行は落ちる', () => {
    // 「書き忘れ」と「録画しなかった」を区別できなくなる。
    const run = validRun();
    delete (run.cases[0] as { recording?: unknown }).recording;
    expectInvalid(run, /recording/);
  });
});

describe('run.json — 何を検証したかを残す', () => {
  it('対象のビルドが分からない実行は落ちる', () => {
    // どのビルドを見たか分からない検証結果は、後から使えない。
    const run = validRun();
    delete (run.target as { build?: unknown }).build;
    expectInvalid(run, /build/);
  });

  it('読んだシートのハッシュを残す（実行後にシートが変わったら分かるように）', () => {
    const run = validRun();
    run.sheet.sha256 = 'not-a-hash';
    expectInvalid(run, /sha256/);
  });

  it('ケースの合否とは別に Finding を残せる', () => {
    const run = validRun();
    run.findings.push({
      id: 'F-001',
      title: '保存直後に一覧の並びが一瞬入れ替わる',
      severity: 'low',
      foundAt: '2026-08-17T14:46:10.000Z',
      caseNo: 2,
    });
    expectValid(run);
  });
});

describe('TS の語彙と JSON Schema の語彙がずれていない', () => {
  const enumOf = (pointer: string[]): unknown => {
    let node: unknown = RUN_SCHEMA;
    for (const key of pointer) {
      node = (node as Record<string, unknown>)[key];
    }
    return node;
  };

  it('result / aiResult / humanResult の候補が一致する', () => {
    const caseSchema = ['$defs', 'case', 'properties'];
    expect(enumOf([...caseSchema, 'result', 'enum'])).toEqual(CASE_RESULTS);
    expect(enumOf([...caseSchema, 'aiResult', 'enum'])).toEqual(AI_RESULTS);
    expect(enumOf([...caseSchema, 'humanResult', 'enum'])).toEqual(HUMAN_RESULTS);
  });
});
