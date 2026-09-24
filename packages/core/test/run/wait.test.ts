import { describe, expect, it } from 'vitest';

import { WAIT_KEY, sheetWaitMs } from '../../src/run/wait.js';

/**
 * **待ち時間がシートから変えられなかった**（外部レビュー meta-taro/git-qa#39）。
 *
 * > **製品は正常なのに FAIL が出ます。**
 * > キャプチャを見たら、入力も押下も成功していました。…
 * > つまり落ちたのは**アプリの不具合ではなく、待ち切る前に見切ったから**です。
 *
 * 既定は 2 秒。**開いて読むだけのページなら足りる。**
 * **押すとサーバを 1 往復する行**（ログイン → リダイレクト、採番してから遷移）では足りない。
 *
 * **CLI の引数にはしない**（報告者の提案 3 —— 報告者自身が薦めていない）。
 *
 * > 実行のたびに変わる値がシートの外にあると、`run.json` を読んだ人が
 * > 「この FAIL は待ち不足か、製品の問題か」を判断できなくなります
 *
 * **シートに書けば、証跡の `sha256` から後で復元できる。**`#22` と同じ理由。
 */
describe('sheetWaitMs', () => {
  it('書いていなければ undefined（既定のまま）', () => {
    expect(sheetWaitMs({})).toBeUndefined();
    expect(sheetWaitMs({ [WAIT_KEY]: '   ' })).toBeUndefined();
  });

  it('秒で書ける', () => {
    expect(sheetWaitMs({ [WAIT_KEY]: '8s' })).toBe(8000);
    expect(sheetWaitMs({ [WAIT_KEY]: '8 s' })).toBe(8000);
    expect(sheetWaitMs({ [WAIT_KEY]: '8秒' })).toBe(8000);
  });

  it('小数の秒も読む（0.5s）', () => {
    expect(sheetWaitMs({ [WAIT_KEY]: '0.5s' })).toBe(500);
  });

  it('ミリ秒でも書ける', () => {
    expect(sheetWaitMs({ [WAIT_KEY]: '8000ms' })).toBe(8000);
  });

  it('単位が無ければ秒として読む（人は秒で考える）', () => {
    expect(sheetWaitMs({ [WAIT_KEY]: '8' })).toBe(8000);
  });

  /**
   * **読めないものは黙って既定にしない**（C20）。
   * 「8 秒待つつもりで書いたのに 2 秒だった」が、**いちばん気づけない。**
   */
  it('読めない書き方は投げる（黙って既定に落とさない）', () => {
    expect(() => sheetWaitMs({ [WAIT_KEY]: 'ながめ' })).toThrow(/待つ/);
    expect(() => sheetWaitMs({ [WAIT_KEY]: '-3s' })).toThrow(/待つ/);
    expect(() => sheetWaitMs({ [WAIT_KEY]: '0' })).toThrow(/待つ/);
  });

  /**
   * **上限を持つ。**打ち間違い（`800s`）で**実行が 1 件 13 分**になると、
   * 人は止めるしかなくなり、証跡が中断で残る。
   */
  it('長すぎるものは投げる（打ち間違いで実行が止まらなくなる）', () => {
    expect(() => sheetWaitMs({ [WAIT_KEY]: '800s' })).toThrow(/待つ/);
  });

  it('上限ちょうどは通る', () => {
    expect(sheetWaitMs({ [WAIT_KEY]: '120s' })).toBe(120_000);
  });
});
