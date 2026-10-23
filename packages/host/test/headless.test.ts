import { describe, expect, it } from 'vitest';

import { headlessExitCode, headlessSummary, runHeadless } from '../src/headless.js';
import { createFakeAdapter, parseTestSpecTsv, type RunCase } from '@git-qa/core';

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

/**
 * **無人の道も、繋ぐ前にシートを見る**（#39 の提案 2・2026-10-23）。
 *
 * 画面のある道（`startRunSession`）は繋ぐ前に `assertRunnableSheet` を通していたが、
 * **無人の道は通していなかった。**行に添えた待ちが読めないまま繋ぐと、
 * **対象を触った跡だけが残る。**
 */
describe('runHeadless — 繋ぐ前にシートを見る', () => {
  it('行に添えた待ちが読めなければ、繋がずに止める', async () => {
    const sheet = parseTestSpecTsv(
      '#! md-business:test-spec-tsv/v1\nNo.:number!\t項目!\t手順:multiline!\t期待結果:multiline!\n' +
        '1\tあ\t1. 「保存」を押す\t「済」と表示される（しばらくまで待つ）\n',
    );
    let connected = false;
    const adapter = createFakeAdapter({});
    const watched = {
      ...adapter,
      connect: () => {
        connected = true;
        return adapter.connect();
      },
    };

    await expect(
      runHeadless({
        adapter: watched,
        sheet,
        sheetRef: { path: 'x.tsv', sha256: 'x' },
        runId: 'r',
        runsRoot: '/nonexistent',
        operator: { handle: 'qa' },
        readScreenText: () => Promise.resolve(''),
      }),
    ).rejects.toThrow(/待つ/);
    expect(connected).toBe(false);
  });
});
