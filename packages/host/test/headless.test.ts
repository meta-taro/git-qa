import { describe, expect, it } from 'vitest';

import { headlessExitCode, headlessSummary } from '../src/headless.js';
import type { RunCase } from '@git-qa/core';

/**
 * **無人で流す口**（外部レビュー meta-taro/git-qa#21）。
 *
 * > 夜間にひととおり流して、**落ちた行と証跡だけを朝に人が見る**
 * > 人が見る前に、機械で落とせる行を先に間引く
 *
 * **人の判断の代替ではない。**出るのは `AUTO_PASS` 止まりで、`VERIFIED` は型として書けない（C17）。
 * ここで決めるのは「**朝に人が開くべきものが在るか**」だけ。
 */
const caseWith = (result: RunCase['result']): RunCase =>
  ({ no: 1, title: 'x', result, steps: [] }) as unknown as RunCase;

describe('headlessExitCode', () => {
  it('全部通っていれば 0', () => {
    expect(headlessExitCode([caseWith('AUTO_PASS'), caseWith('AUTO_PASS')])).toBe(0);
  });

  /** **落ちた行が在れば 1。**朝に開く前に分かる、がこの口の実体。 */
  it('落ちた行が在れば 1', () => {
    expect(headlessExitCode([caseWith('AUTO_PASS'), caseWith('FAIL')])).toBe(1);
  });

  /**
   * **判断保留は 2。**落ちてはいないが、**人が見ないと決まらない行**が在る。
   * 0 にすると「見なくてよい」と読めてしまう。
   */
  it('判断保留が在れば 2', () => {
    expect(headlessExitCode([caseWith('AUTO_PASS'), caseWith('BLOCKED')])).toBe(2);
  });

  /** 落ちた行と保留が両方在るなら、**重いほう**（落ちた行）を出す。 */
  it('落ちた行が優先される', () => {
    expect(headlessExitCode([caseWith('BLOCKED'), caseWith('FAIL')])).toBe(1);
  });

  /** `SKIP` は「今回は見ない」と決めた行。**落ちてはいない。** */
  it('見ないと決めた行は、落ちた扱いにしない', () => {
    expect(headlessExitCode([caseWith('AUTO_PASS'), caseWith('SKIP')])).toBe(0);
  });

  /** **1 件も走っていないなら 0 ではない。**空の実行を「通った」と読ませない。 */
  it('1 件も無ければ 2', () => {
    expect(headlessExitCode([])).toBe(2);
  });
});

describe('headlessSummary', () => {
  it('内訳を数で出す', () => {
    const said = headlessSummary([caseWith('AUTO_PASS'), caseWith('FAIL'), caseWith('BLOCKED')]);

    expect(said).toContain('3');
    expect(said).toContain('FAIL 1');
    expect(said).toContain('BLOCKED 1');
  });

  /** **`VERIFIED` は出ない。**無人の実行に「人が見た」は在りえない（C17）。 */
  it('人が見た、とは言わない', () => {
    expect(headlessSummary([caseWith('AUTO_PASS')])).not.toContain('VERIFIED');
  });
});
