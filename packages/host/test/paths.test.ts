import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fromInvocationDir, runHomeFor, runsDir } from '../src/paths.js';

/**
 * その OS での、その場所。
 *
 * **区切りも根も OS が決める。**`/repo/docs/a.tsv` と直書きすると、Windows では
 * `D:\repo\docs\a.tsv` が返って落ちる（2026-09-11・Windows 版を初めて建てて分かった）。
 * 見たいのは**どこを指すか**であって、区切りが `/` か `\` かではない。
 */
const at = (path: string): string => resolve(path);

/**
 * `pnpm --filter @git-qa/host exec ...` は**作業ディレクトリをパッケージへ移す。**
 * 人はリポジトリのルートで打っているので、そのままだとシートも `runs/` も別の場所を指す
 * （**実際にこれで動かなかった**）。
 */

describe('fromInvocationDir', () => {
  it('人が打った場所（INIT_CWD）を基準に解決する', () => {
    expect(
      fromInvocationDir('docs/a.tsv', { INIT_CWD: at('/repo') }, at('/repo/packages/host')),
    ).toBe(at('/repo/docs/a.tsv'));
  });

  it('INIT_CWD が無ければ、いまの作業ディレクトリを基準にする', () => {
    expect(fromInvocationDir('a.tsv', {}, at('/repo/packages/host'))).toBe(
      at('/repo/packages/host/a.tsv'),
    );
  });

  it('絶対パスはそのまま', () => {
    expect(
      fromInvocationDir(at('/tmp/a.tsv'), { INIT_CWD: at('/repo') }, at('/repo/packages/host')),
    ).toBe(at('/tmp/a.tsv'));
  });
});

/**
 * **書けない所へ証跡を書こうとしない。**
 *
 * Finder から `.app` を起動すると作業ディレクトリが `/` になる。そのまま `runs/` を
 * 作ろうとすると `/runs` になり、macOS では書けない。**5 件の判定を置いたあとに
 * 保存で落ちるのが、いちばん高くつく壊れ方。**
 *
 * 書けない場所だったときは、人が開ける所（書類フォルダ）へ置く。
 */
describe('証跡の置き場', () => {
  it('打った場所が普通のディレクトリなら、その下に置く', () => {
    expect(runsDir('runs', { INIT_CWD: at('/home/me/project') })).toBe(at('/home/me/project/runs'));
  });

  it('作業ディレクトリが / なら、書類フォルダの下へ逃がす', () => {
    const path = runsDir('runs', {}, '/');

    expect(path).toBe(join(homedir(), 'Documents', 'git-qa', 'runs'));
  });
});

/**
 * **コマンドから回しても、証跡は試験の家へ出す**（2026-10-23）。
 *
 * 画面から始める道（`app-cli`）は、シートの近くの `git-qa.json` を見て、その `runs/` へ出していた。
 * コマンドの道（`run:sheet:web` / `run:sheet:desktop`）は**打った場所の `runs/`** へ出していて、
 * **シートのフォルダから打ったときしか、家に出なかった。**同じシートで、入口によって証跡が割れる。
 */
describe('runHomeFor', () => {
  const sheet = at('/proj/docs/test-specs/web.tsv');
  const env = { INIT_CWD: at('/elsewhere') };

  it('git-qa.json があれば、その runs/ へ出し、シートは家からの相対で書く', () => {
    const exists = (p: string): boolean => p === join(at('/proj/docs/test-specs'), 'git-qa.json');

    // シートのフォルダではない所（/elsewhere）から、絶対パスで渡しても家へ出る。
    expect(runHomeFor(sheet, env, at('/elsewhere'), exists)).toEqual({
      sheetPath: sheet,
      runsRoot: join(at('/proj/docs/test-specs'), 'runs'),
      sheetRefPath: 'web.tsv',
    });
  });

  it('印が無ければ今までどおり（打った場所の runs/・シートは打ったまま）', () => {
    expect(runHomeFor('docs/a.tsv', env, at('/elsewhere'), () => false)).toEqual({
      sheetPath: at('/elsewhere/docs/a.tsv'),
      runsRoot: at('/elsewhere/runs'),
      sheetRefPath: 'docs/a.tsv',
    });
  });
});
