import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { caseDir, caseDirName, runDir, runJsonPath } from '../../src/index.js';

describe('runs/<runId>/<caseId>/ の並べ方', () => {
  it('ケース番号をゼロ埋めした名前にする', () => {
    // 桁が揃っていないと、ファイラでも ls でも並び順が番号順にならない。
    expect(caseDirName(1)).toBe('case-001');
    expect(caseDirName(42)).toBe('case-042');
  });

  it('3 桁を超えたケース番号は切らずにそのまま伸ばす', () => {
    expect(caseDirName(1234)).toBe('case-1234');
  });

  it('ケース番号が正の整数でなければ落ちる', () => {
    expect(() => caseDirName(0)).toThrowError();
    expect(() => caseDirName(-1)).toThrowError();
    expect(() => caseDirName(1.5)).toThrowError();
  });

  it('run.json は実行ディレクトリの直下に置く', () => {
    const path = runJsonPath('runs', '20260817-144530');
    expect(path).toBe(['runs', '20260817-144530', 'run.json'].join(sep));
  });

  it('ケースの証跡は実行ディレクトリの下のケースディレクトリに置く', () => {
    const path = caseDir('runs', '20260817-144530', 3);
    expect(path).toBe(['runs', '20260817-144530', 'case-003'].join(sep));
  });

  it('runId に経路区切りが混ざっていたら落ちる', () => {
    // runId は外から渡ってくる。素通ししてディレクトリを掘ると、
    // runs/ の外へ書き込む口になる。
    expect(() => runDir('runs', '../etc')).toThrowError();
    expect(() => runDir('runs', 'a/b')).toThrowError();
    expect(() => runDir('runs', 'a\\b')).toThrowError();
    expect(() => runDir('runs', '')).toThrowError();
  });
});
