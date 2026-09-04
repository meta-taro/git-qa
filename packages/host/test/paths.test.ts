import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fromInvocationDir, runsDir } from '../src/paths.js';

/**
 * `pnpm --filter @git-qa/host exec ...` は**作業ディレクトリをパッケージへ移す。**
 * 人はリポジトリのルートで打っているので、そのままだとシートも `runs/` も別の場所を指す
 * （**実際にこれで動かなかった**）。
 */

describe('fromInvocationDir', () => {
  it('人が打った場所（INIT_CWD）を基準に解決する', () => {
    expect(fromInvocationDir('docs/a.tsv', { INIT_CWD: '/repo' }, '/repo/packages/host')).toBe(
      '/repo/docs/a.tsv',
    );
  });

  it('INIT_CWD が無ければ、いまの作業ディレクトリを基準にする', () => {
    expect(fromInvocationDir('a.tsv', {}, '/repo/packages/host')).toBe('/repo/packages/host/a.tsv');
  });

  it('絶対パスはそのまま', () => {
    expect(fromInvocationDir('/tmp/a.tsv', { INIT_CWD: '/repo' }, '/repo/packages/host')).toBe(
      '/tmp/a.tsv',
    );
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
    expect(runsDir('runs', { INIT_CWD: '/home/me/project' })).toBe('/home/me/project/runs');
  });

  it('作業ディレクトリが / なら、書類フォルダの下へ逃がす', () => {
    const path = runsDir('runs', {}, '/');

    expect(path).toBe(join(homedir(), 'Documents', 'git-qa', 'runs'));
  });
});
