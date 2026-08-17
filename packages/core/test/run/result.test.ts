import { describe, expect, it } from 'vitest';

import { AI_RESULTS, CASE_RESULTS, HUMAN_RESULTS, resolveCaseResult } from '../../src/index.js';

describe('結果の語彙（C1）', () => {
  it('ケースの結果は 5 値', () => {
    expect(CASE_RESULTS).toEqual(['VERIFIED', 'AUTO_PASS', 'FAIL', 'BLOCKED', 'SKIP']);
  });

  it('AI は VERIFIED を出せない', () => {
    // 「人が名前を置いた」は AI の語彙に無い。
    // 実行時の分岐で守るのではなく、値として持てないようにする。
    expect(AI_RESULTS).not.toContain('VERIFIED');
    expect(AI_RESULTS).toEqual(['PASS', 'FAIL', 'BLOCKED', 'SKIP']);
  });

  it('人は AUTO_PASS を出せない', () => {
    // AUTO_PASS は「誰も見ていない」ことの記録なので、人が付ける値ではない。
    expect(HUMAN_RESULTS).not.toContain('AUTO_PASS');
    expect(HUMAN_RESULTS).toEqual(['VERIFIED', 'FAIL', 'BLOCKED', 'SKIP']);
  });
});

describe('resolveCaseResult', () => {
  it('AI が通しただけなら AUTO_PASS になる（VERIFIED にならない）', () => {
    expect(resolveCaseResult({ aiResult: 'PASS' })).toBe('AUTO_PASS');
  });

  it('人が見て通したら VERIFIED になる', () => {
    expect(resolveCaseResult({ humanResult: 'VERIFIED' })).toBe('VERIFIED');
  });

  it('AI が通していても、人が落としたら FAIL になる', () => {
    // 見た人の判断が最後に来る。ここが逆転するとこの製品の意味が無い。
    expect(resolveCaseResult({ aiResult: 'PASS', humanResult: 'FAIL' })).toBe('FAIL');
  });

  it('AI が落としていても、人が見て通したら VERIFIED になる', () => {
    expect(resolveCaseResult({ aiResult: 'FAIL', humanResult: 'VERIFIED' })).toBe('VERIFIED');
  });

  it('AI の FAIL / BLOCKED / SKIP はそのまま残る', () => {
    expect(resolveCaseResult({ aiResult: 'FAIL' })).toBe('FAIL');
    expect(resolveCaseResult({ aiResult: 'BLOCKED' })).toBe('BLOCKED');
    expect(resolveCaseResult({ aiResult: 'SKIP' })).toBe('SKIP');
  });

  it('どちらも実行していなければ SKIP', () => {
    expect(resolveCaseResult({})).toBe('SKIP');
  });
});
