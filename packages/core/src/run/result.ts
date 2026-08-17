import type { AiResult, CaseResult, HumanResult } from './types.js';

export interface ResultInput {
  aiResult?: AiResult;
  humanResult?: HumanResult;
}

/**
 * AI の結果と人の結果から、ケースの最終結果を決める（decisions.md C1）。
 *
 * **見た人の判断が最後に来る。**AI が通していても人が落としたら落ちるし、
 * AI が落としていても人が見て通したら `VERIFIED` になる。ここが逆転すると製品の意味が無い。
 *
 * 人が触っていない `PASS` は `AUTO_PASS`。`VERIFIED` に繰り上げない。
 */
export function resolveCaseResult({ aiResult, humanResult }: ResultInput): CaseResult {
  if (humanResult !== undefined) {
    return humanResult;
  }
  if (aiResult === undefined) {
    // どちらも実行していない。「通った」ではなく「やっていない」。
    return 'SKIP';
  }
  return aiResult === 'PASS' ? 'AUTO_PASS' : aiResult;
}
