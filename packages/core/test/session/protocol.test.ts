import { describe, expect, it } from 'vitest';

import { parseHumanInput, parseSessionState } from '../../src/session/protocol.js';

/**
 * 画面（webview）と実行器（Node）がやりとりする形。
 *
 * **どちらも相手を信用しない。**橋を通って来るものは `unknown` で、
 * 形が違えば受け取らない。受け取ってしまうと、`run.json` に嘘が入る。
 */

describe('parseHumanInput — 画面から届いた打鍵', () => {
  it('人の判定を受け取る', () => {
    expect(parseHumanInput({ kind: 'verdict', caseNo: 3, humanResult: 'VERIFIED' })).toEqual({
      kind: 'verdict',
      caseNo: 3,
      humanResult: 'VERIFIED',
    });
  });

  it('置かずに次へ進む指示を受け取る', () => {
    expect(parseHumanInput({ kind: 'advance', caseNo: 3 })).toEqual({ kind: 'advance', caseNo: 3 });
  });

  it('取り消しはまだ受け取らない（実装が無いものを型で通さない）', () => {
    expect(parseHumanInput({ kind: 'undo' })).toBeUndefined();
  });

  it('AUTO_PASS は人の値ではないので受け取らない（C17）', () => {
    expect(
      parseHumanInput({ kind: 'verdict', caseNo: 1, humanResult: 'AUTO_PASS' }),
    ).toBeUndefined();
  });

  it('知らない形は受け取らない', () => {
    expect(parseHumanInput({ kind: 'verdict', caseNo: 1 })).toBeUndefined();
    expect(
      parseHumanInput({ kind: 'verdict', caseNo: '1', humanResult: 'VERIFIED' }),
    ).toBeUndefined();
    expect(parseHumanInput({ kind: 'なにか' })).toBeUndefined();
    expect(parseHumanInput('verdict')).toBeUndefined();
    expect(parseHumanInput(null)).toBeUndefined();
  });

  it('ケース番号は 1 以上の整数でなければ受け取らない', () => {
    expect(parseHumanInput({ kind: 'advance', caseNo: 0 })).toBeUndefined();
    expect(parseHumanInput({ kind: 'advance', caseNo: 1.5 })).toBeUndefined();
  });
});

describe('parseSessionState — Node から届いた実行状態', () => {
  const state = {
    runId: '20260902-150000',
    phase: 'waiting',
    awaiting: 2,
    cases: [
      {
        no: 1,
        title: 'アプリが起動する',
        aiResult: 'BLOCKED',
        result: 'VERIFIED',
        verifiedBy: 'octocat',
      },
      { no: 2, title: 'メモを保存できる', aiResult: 'PASS' },
    ],
  };

  it('そのまま読める', () => {
    expect(parseSessionState(state)).toEqual(state);
  });

  it('ケースが無ければ受け取らない', () => {
    expect(parseSessionState({ runId: 'r', phase: 'running' })).toBeUndefined();
  });

  it('知らない phase は受け取らない', () => {
    expect(parseSessionState({ ...state, phase: 'ねている' })).toBeUndefined();
  });

  it('知らない結果の値は受け取らない', () => {
    expect(
      parseSessionState({ ...state, cases: [{ no: 1, title: 'あ', aiResult: 'VERIFIED' }] }),
    ).toBeUndefined();
  });
});

describe('parseHumanInput — 人が端末を触る', () => {
  it('画面の中の tap を受け取る', () => {
    expect(parseHumanInput({ kind: 'tap', caseNo: 2, x: 540, y: 1200 })).toEqual({
      kind: 'tap',
      caseNo: 2,
      x: 540,
      y: 1200,
    });
  });

  it('座標が無い・数でないものは受け取らない', () => {
    expect(parseHumanInput({ kind: 'tap', caseNo: 2, x: 540 })).toBeUndefined();
    expect(parseHumanInput({ kind: 'tap', caseNo: 2, x: '540', y: 1200 })).toBeUndefined();
  });

  it('負の座標は受け取らない（枠の外を押している）', () => {
    expect(parseHumanInput({ kind: 'tap', caseNo: 2, x: -1, y: 10 })).toBeUndefined();
  });

  it('整数でない座標は丸めずに捨てる（端末は画素の位置しか受け取らない）', () => {
    expect(parseHumanInput({ kind: 'tap', caseNo: 2, x: 10.5, y: 10 })).toBeUndefined();
  });
});
