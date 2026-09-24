import { describe, expect, it } from 'vitest';

import { sheetGuideOr } from '../src/sheet-guide.js';

/**
 * **検証シートの書き方を、エージェントへ渡す**（2026-09-24・人の指示）。
 *
 * > 検証シート作成ノウハウは MCP などでエージェントに共有できる仕組みにしてください
 *
 * **同じ日に、同じ相手が 3 回、雑なシートを書いた。**
 * ノウハウが**どこにも無かった**ため。**文書に書くだけでは、次のエージェントが読まない。**
 *
 * **文書を正本にして読み出す。**ここに文字列を埋めると、文書と実装がずれる（§10）。
 */
describe('sheetGuideOr', () => {
  it('読めた文書を、そのまま渡す（ここで書き換えない）', () => {
    const said = sheetGuideOr('# 検証シートの書き方\n押す前から在る文字を書かない');

    expect(said).toContain('押す前から在る文字を書かない');
  });

  /**
   * **読めなかったことを、黙って空で返さない**（C20）。
   * 空を返すと、聞いた側は「ノウハウは無い」と受け取る。
   */
  it('読めなければ、読めないと言う', () => {
    const said = sheetGuideOr(undefined);

    expect(said).toMatch(/読めなかった/);
  });

  /** **読めなくても、いちばん効く 1 つだけは渡す。**それが無いと雑なシートが通る。 */
  it('読めなくても、いちばん大事な 1 つは渡す', () => {
    const said = sheetGuideOr(undefined);

    expect(said).toContain('押す前');
  });
});
