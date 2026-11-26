import { describe, expect, it } from 'vitest';

import { combineExitCodes, resolveViewports, runIdFor } from '../src/viewports.js';
import { positional } from '../src/argv.js';

/**
 * **ページの表示領域の大きさを、シートか引数で決める**（2026-11-26・C122）。
 *
 * シートの `# 画面:` が基本。`--viewport` は**同じシートを CI で複数の幅に当てる**ための口で、
 * 渡されればシートより優先する。どちらも無ければ `undefined`（今までどおりの窓）。
 */
describe('resolveViewports', () => {
  it('シートの「# 画面:」を読む', () => {
    expect(resolveViewports(['node', 'x.ts', 'sheet.tsv'], { 画面: '390x844' })).toEqual([
      { width: 390, height: 844 },
    ]);
  });

  it('--viewport があればシートより優先', () => {
    expect(
      resolveViewports(['node', 'x.ts', 'sheet.tsv', '--viewport', '1440x900'], {
        画面: '390x844',
      }),
    ).toEqual([{ width: 1440, height: 900 }]);
  });

  it('--viewport=390x844,1440x900 の形も読む', () => {
    expect(
      resolveViewports(['node', 'x.ts', 'sheet.tsv', '--viewport=390x844,1440x900'], {}),
    ).toEqual([
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]);
  });

  /** **既存のシートは 1 文字も変えずに動く。** */
  it('どちらも無ければ undefined', () => {
    expect(resolveViewports(['node', 'x.ts', 'sheet.tsv'], {})).toBeUndefined();
  });

  /** 値の無い `--viewport` は打ち間違い。黙って既定に落とさない（C20）。 */
  it('--viewport に値が無ければ投げる', () => {
    expect(() => resolveViewports(['node', 'x.ts', 'sheet.tsv', '--viewport'], {})).toThrow(
      /--viewport/,
    );
    expect(() =>
      resolveViewports(['node', 'x.ts', 'sheet.tsv', '--viewport', '--no-ui'], {}),
    ).toThrow(/--viewport/);
  });
});

/**
 * **`--viewport 390x844` の値を、場所で数える引数に混ぜない**（#21 の轍）。
 * `pnpm run:sheet:web sheet.tsv --viewport 390x844` で `390x844` が URL として読まれてはいけない。
 */
describe('positional と値つきの旗', () => {
  it('--viewport の値は場所で数えない', () => {
    const argv = ['node', 'x.ts', 'sheet.tsv', '--viewport', '390x844', 'http://a/'];
    expect(positional(argv, 0)).toBe('sheet.tsv');
    expect(positional(argv, 1)).toBe('http://a/');
  });

  it('--viewport=390x844 の形は元から旗', () => {
    const argv = ['node', 'x.ts', '--viewport=390x844', 'sheet.tsv'];
    expect(positional(argv, 0)).toBe('sheet.tsv');
    expect(positional(argv, 1)).toBeUndefined();
  });
});

/**
 * **幅ごとに証跡を分ける。**1 本の `run.json` は 1 つの大きさで見たもの。
 * 複数の幅は run を分け、どの幅か分かる名前にする。
 */
describe('runIdFor', () => {
  it('1 つなら今までどおりの名前', () => {
    expect(runIdFor('20261126-220000', { width: 390, height: 844 }, 1)).toBe('20261126-220000');
  });

  it('複数なら大きさを添える', () => {
    expect(runIdFor('20261126-220000', { width: 390, height: 844 }, 2)).toBe(
      '20261126-220000-390x844',
    );
  });

  it('大きさを決めていなければ、そのまま', () => {
    expect(runIdFor('20261126-220000', undefined, 1)).toBe('20261126-220000');
  });
});

/**
 * 無人（`--no-ui`）で複数の幅を回したときの終了コード。
 * **1 つでも落ちていれば 1。**落ちていないが人が見ないと決まらない幅があれば 2。
 */
describe('combineExitCodes', () => {
  it('全部 0 なら 0', () => {
    expect(combineExitCodes([0, 0])).toBe(0);
  });
  it('1 が勝つ', () => {
    expect(combineExitCodes([2, 1, 0])).toBe(1);
  });
  it('1 が無ければ 2', () => {
    expect(combineExitCodes([0, 2])).toBe(2);
  });
  it('何も回していなければ 2（見るものが無いのは「通った」ではない）', () => {
    expect(combineExitCodes([])).toBe(2);
  });
});
