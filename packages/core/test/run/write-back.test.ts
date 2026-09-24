import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeBackToSheet } from '../../src/run/fill-sheet.js';

/**
 * **正本のシートへ書き戻す**（2026-09-24・人の判断）。
 *
 * > git 管理されたものが壊れるのをなぜ気にするのですか？
 * > また md-business は壊れた tsv を修復できます。**役割を分担してください。**
 *
 * **守りを重ねない。**履歴は git が、様式の修復は md-business が持っている。
 * **git-qa の仕事は「人が置いた判定を書く」だけ。**
 */
const SHEET = [
  '#! md-business:test-spec-tsv/v1',
  '# ステータス: 未実施',
  'No.:number!\t項目!\t手順!\t期待結果!\t結果:enum(OK|NG|保留|未実施)!\t実施日:date\t担当',
  '1\tあ\t押す\t「あ」と表示される\t未実施\t\t',
  '',
].join('\n');

const makeSheet = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'git-qa-sheet-'));
  const path = join(dir, 'sheet.tsv');
  await writeFile(path, SHEET, 'utf8');
  return path;
};

const run = (path: string) => ({
  sheet: { path, sha256: '0'.repeat(64) },
  operator: { handle: 'octocat' },
  startedAt: '2026-09-24T01:00:00.000Z',
  cases: [{ no: 1, result: 'VERIFIED', verifiedBy: 'octocat' }],
});

describe('writeBackToSheet', () => {
  it('人が置いた判定を、正本へ書く', async () => {
    const path = await makeSheet();
    const said = await writeBackToSheet(run(path));

    expect(said.filled).toBe(1);
    expect(await readFile(path, 'utf8')).toContain('\tOK\t2026-09-24\toctocat');
  });

  it('シートが読めなくても落ちない（証跡は既に残っている）', async () => {
    const said = await writeBackToSheet(run('/nope/sheet.tsv'));

    expect(said.filled).toBe(0);
    expect(said.why).not.toBe('');
  });
});
