import { describe, expect, it } from 'vitest';

import { positional } from '../src/argv.js';

/**
 * **旗を、場所で数える引数に混ぜない**（外部レビュー meta-taro/git-qa#21・実際に踏んだ）。
 *
 * `--no-ui` を足した直後に走らせたら、こう出た。
 *
 * ```
 * pnpm run:sheet:web sheets/web-sample-ja.tsv --no-ui
 * → [git-qa] 見る場所が分からない
 * ```
 *
 * **`--no-ui` が「2 つ目の引数（URL）」として読まれていた。**
 * 単体の検査は全部通っていたので、**1 回走らせるまで分からなかった。**
 */
describe('positional', () => {
  const argv = ['node', 'run-web-cli.ts', 'sheet.tsv', '--no-ui'];

  it('旗を飛ばして数える', () => {
    expect(positional(argv, 0)).toBe('sheet.tsv');
    expect(positional(argv, 1)).toBeUndefined();
  });

  it('旗の後ろにある値も拾う', () => {
    expect(positional(['node', 'x.ts', '--no-ui', 'sheet.tsv', 'http://a/'], 1)).toBe('http://a/');
  });

  it('無ければ undefined', () => {
    expect(positional(['node', 'x.ts'], 0)).toBeUndefined();
  });

  /** `-` 1 つの旗も飛ばす。**数え方を旗の書き方で変えない。** */
  it('短い旗も飛ばす', () => {
    expect(positional(['node', 'x.ts', '-q', 'sheet.tsv'], 0)).toBe('sheet.tsv');
  });
});
