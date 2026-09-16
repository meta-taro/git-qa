import { describe, expect, it } from 'vitest';

import {
  DESTINATION_KEY,
  SUBJECT_KEY,
  duplicateTargetMessage,
  sheetDestination,
  sheetSubject,
} from '../../src/run/sheet-target.js';

/**
 * **「何を検証したか」と「何処を見るか」を分ける**（外部レビュー meta-taro/git-qa#22）。
 *
 * > `# 対象:` には **どのリポジトリのどのブランチを検証したか**を書く規約になっています。
 * > …`# 対象:` を URL に書き換えれば通りますが、そうすると今度は
 * > **どのブランチを検証したシートなのかがシートから消えます**。
 *
 * 引数で URL を渡す回避もあるが、それは **C40 が守ろうとしているものを外す** ——
 * シートの外から行き先が来ると、**証跡を読んだ人が「何処を見たのか」をシートから辿れない。**
 *
 * だから**見出しを 1 行増やす。****既存のシートは 1 文字も変えずに動く。**
 */
describe('sheetDestination — 何処を見るか', () => {
  it('「行き先」が在れば、それを使う', () => {
    const meta = { [SUBJECT_KEY]: 'owner/repo@main', [DESTINATION_KEY]: 'http://localhost:3000/' };

    expect(sheetDestination(meta)).toBe('http://localhost:3000/');
  });

  /** **既存のシートは、そのまま動く。**これが無ければ、書き換えを強いることになる。 */
  it('無ければ「対象」を使う', () => {
    expect(sheetDestination({ [SUBJECT_KEY]: 'http://localhost:3000/' })).toBe(
      'http://localhost:3000/',
    );
  });

  it('どちらも無ければ、分からない', () => {
    expect(sheetDestination({})).toBeUndefined();
  });

  /** 空白だけの行は「書いていない」と同じ。**空欄で行き先を決めない。** */
  it('空白だけなら、書いていないものとして扱う', () => {
    const meta = { [SUBJECT_KEY]: 'owner/repo@main', [DESTINATION_KEY]: '   ' };

    expect(sheetDestination(meta)).toBe('owner/repo@main');
  });
});

describe('sheetSubject — 何を検証したか', () => {
  it('「対象」をそのまま返す', () => {
    expect(sheetSubject({ [SUBJECT_KEY]: 'owner/repo@main' })).toBe('owner/repo@main');
  });

  /**
   * **証跡には、シートが言っていることをそのまま残す。**
   * 行き先だけ残すと、「どのブランチを検証したか」が証跡から消える。
   */
  it('行き先が別に在っても、対象は対象のまま', () => {
    const meta = { [SUBJECT_KEY]: 'owner/repo@main', [DESTINATION_KEY]: 'http://localhost:3000/' };

    expect(sheetSubject(meta)).toBe('owner/repo@main');
  });

  it('無ければ、分からない', () => {
    expect(sheetSubject({})).toBeUndefined();
  });
});

/**
 * **行き先が 2 つ在るシートは、走らせない**（外部レビュー meta-taro/git-qa#22）。
 *
 * > シートを人が手で編集する以上、コピーの取り違えで 2 行になることは起こりえます。
 * > **C40（宣言した所から出ない）を考えると、重複は黙って後勝ちにするより弾いたほうが安全**
 *
 * 後勝ちで動くと、**証跡を読んだ人が「何処を見たのか」をシートから辿れない。**
 * シートに 2 つ書いてあって、run.json には 1 つしか残らないので、突き合わせが合わなくなる。
 */
describe('duplicateTargetMessage', () => {
  it('行き先が 2 行あれば、断る', () => {
    const said = duplicateTargetMessage(['行き先']);

    expect(said).toContain('行き先');
    // **どう直すかまで言う。**「駄目です」だけだと、人はシートを眺めることになる。
    expect(said).toContain('1 行');
  });

  it('対象が 2 行あっても、断る', () => {
    expect(duplicateTargetMessage(['対象'])).toContain('対象');
  });

  /** **関係ない鍵は、こちらの持ち場ではない。**凡例が 2 行あっても走る。 */
  it('行き先に関係しない重複は、断らない', () => {
    expect(duplicateTargetMessage(['凡例', 'ステータス'])).toBeUndefined();
  });

  it('重複が無ければ、断らない', () => {
    expect(duplicateTargetMessage([])).toBeUndefined();
  });
});
