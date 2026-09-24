import { describe, expect, it } from 'vitest';

import { RESULT_COLUMN, fillSheetResults } from '../../src/run/fill-sheet.js';

/**
 * **正本のシートに、誰がいつ確かめたかを書き戻す**（2026-09-24・人の判断）。
 *
 * > だれがいつどう検査したか正本が更新されないなら、なにが便利なんですか？
 * > git-qa といった名前や、md-business も git 管理がすべてです。
 * > **直接つど更新することがのぞましい**と、わたしは現時点で判断しています。
 *
 * **C3（TSV へ書き戻さない）を覆した。**実物のシートは最初から
 * `結果 / 実施日 / 担当` を持っていて、**書き込まれる前提で作られていた。**
 *
 * **絶対に守る線が 1 つ。****AI が出しただけの判定は書かない**
 * （`product-baseline.md` §19「合否は実物を見た人が記入する。AI が代筆しない」）。
 */
const SHEET = [
  '#! md-business:test-spec-tsv/v1',
  '# タイトル: 見本',
  '# ステータス: 未実施',
  'No.:number!\t項目!\t手順:multiline!\t期待結果!\t結果:enum(OK|NG|保留|未実施)!\t実施日:date\t担当',
  '1\tあ\t押す\t「あ」と表示される\t未実施\t\t',
  '2\tい\t押す\t「い」と表示される\t未実施\t\t',
  '3\tう\t押す\t「う」と表示される\t未実施\t\t',
  '',
].join('\n');

const placed = (no: number, result: string, by?: string) => ({
  no,
  result,
  ...(by === undefined ? {} : { verifiedBy: by }),
});

describe('fillSheetResults', () => {
  it('人が置いた行だけ、結果と実施日と担当を書く', () => {
    const said = fillSheetResults(SHEET, {
      cases: [placed(1, 'VERIFIED', 'octocat')],
      date: '2026-09-24',
    });

    expect(said.text).toContain('1\tあ\t押す\t「あ」と表示される\tOK\t2026-09-24\toctocat');
  });

  /** **AI が出しただけのものは書かない。**これが線。 */
  it('AUTO_PASS は書かない（人が見ていないので）', () => {
    const said = fillSheetResults(SHEET, {
      cases: [placed(1, 'AUTO_PASS')],
      date: '2026-09-24',
    });

    expect(said.text).toContain('1\tあ\t押す\t「あ」と表示される\t未実施\t\t');
    expect(said.filled).toBe(0);
  });

  it('SKIP も書かない（「今回は見ない」は結果ではない）', () => {
    const said = fillSheetResults(SHEET, {
      cases: [placed(1, 'SKIP', 'octocat')],
      date: '2026-09-24',
    });

    expect(said.filled).toBe(0);
  });

  it('FAIL は NG、BLOCKED は保留', () => {
    const said = fillSheetResults(SHEET, {
      cases: [placed(1, 'FAIL', 'octocat'), placed(2, 'BLOCKED', 'octocat')],
      date: '2026-09-24',
    });

    expect(said.text).toContain('\tNG\t2026-09-24\toctocat');
    expect(said.text).toContain('\t保留\t2026-09-24\toctocat');
  });

  /** **途中で止めた行は触らない。**走っていないものを「未実施」のままにする。 */
  it('置いていない行は、そのまま残す', () => {
    const said = fillSheetResults(SHEET, {
      cases: [placed(1, 'VERIFIED', 'octocat')],
      date: '2026-09-24',
    });

    expect(said.text).toContain('3\tう\t押す\t「う」と表示される\t未実施\t\t');
  });

  it('全部に人の判定が付いたときだけ、見出しの状態を変える', () => {
    const half = fillSheetResults(SHEET, {
      cases: [placed(1, 'VERIFIED', 'o')],
      date: '2026-09-24',
    });
    const all = fillSheetResults(SHEET, {
      cases: [placed(1, 'VERIFIED', 'o'), placed(2, 'VERIFIED', 'o'), placed(3, 'FAIL', 'o')],
      date: '2026-09-24',
    });

    expect(half.text).toContain('# ステータス: 未実施');
    expect(all.text).toContain('# ステータス: 実施済み');
  });

  /** **列を足さない。**シートの形を勝手に変えない。 */
  it('結果の列が無いシートには書かない', () => {
    const noColumn = [
      '#! md-business:test-spec-tsv/v1',
      'No.:number!\t項目!\t手順!\t期待結果!',
      '1\tあ\t押す\t「あ」',
      '',
    ].join('\n');

    const said = fillSheetResults(noColumn, {
      cases: [placed(1, 'VERIFIED', 'o')],
      date: '2026-09-24',
    });

    expect(said.text).toBe(noColumn);
    expect(said.filled).toBe(0);
    expect(said.why).toContain(RESULT_COLUMN);
  });

  it('No. が合う行が無ければ、黙って飛ばさずに数える', () => {
    const said = fillSheetResults(SHEET, {
      cases: [placed(9, 'VERIFIED', 'o')],
      date: '2026-09-24',
    });

    expect(said.filled).toBe(0);
    expect(said.missed).toEqual([9]);
  });

  it('元の行の中身は、書く列以外そのまま', () => {
    const said = fillSheetResults(SHEET, {
      cases: [placed(2, 'VERIFIED', 'o')],
      date: '2026-09-24',
    });

    expect(said.text).toContain('# タイトル: 見本');
    expect(said.text.split('\n')).toHaveLength(SHEET.split('\n').length);
  });
});
