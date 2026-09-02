import { describe, expect, it } from 'vitest';

import { fromInvocationDir } from '../src/paths.js';

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
