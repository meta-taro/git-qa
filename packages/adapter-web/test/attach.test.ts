import { describe, expect, it } from 'vitest';

import { attachedNote, devToolsUrlFrom, shouldCloseBrowser } from '../src/attach.js';

/**
 * **既に起きているブラウザへ繋ぐ**（meta-taro/git-qa#30）。
 *
 * > Playwright で書いてある手順（ログイン・データ用意・複雑な操作）を使い回せない
 *
 * **操作はそちら、判定はこちら**という分担にする。**Playwright を再実装しない**（PRD の非目標）。
 *
 * **他人のものを片付けない。**自分で起こしていないブラウザを閉じるのは、
 * #20（30 個溜めた）の逆側の間違い —— **人が使っているものを勝手に落とす。**
 */
describe('devToolsUrlFrom', () => {
  it('ws の繋ぎ先は、そのまま使う', () => {
    expect(devToolsUrlFrom('ws://127.0.0.1:9222/devtools/browser/abc')).toBe(
      'ws://127.0.0.1:9222/devtools/browser/abc',
    );
  });

  /** **人は `http://127.0.0.1:9222` を渡す。**そこから繋ぎ先を引ければ、書かせない。 */
  it('http の入口も受ける', () => {
    expect(devToolsUrlFrom('http://127.0.0.1:9222')).toBe('ws://127.0.0.1:9222');
  });

  it('末尾の / は落とす', () => {
    expect(devToolsUrlFrom('http://127.0.0.1:9222/')).toBe('ws://127.0.0.1:9222');
  });

  /** **読めないものを当てにいかない。**繋ぎ先が分からないまま触らない。 */
  it('読めない繋ぎ先は受け取らない', () => {
    expect(devToolsUrlFrom('9222')).toBeUndefined();
    expect(devToolsUrlFrom('')).toBeUndefined();
  });
});

describe('shouldCloseBrowser', () => {
  it('自分で起こしたものは閉じる', () => {
    expect(shouldCloseBrowser(undefined)).toBe(true);
  });

  /** **他人のものは閉じない。**Playwright が使っている最中かもしれない。 */
  it('繋いだだけのものは閉じない', () => {
    expect(shouldCloseBrowser('http://127.0.0.1:9222')).toBe(false);
  });
});

describe('attachedNote', () => {
  /** **自分で起こした実行と混ぜない。**前準備を誰がやったのかで、証跡の意味が変わる。 */
  it('繋いだことを証跡へ残す', () => {
    expect(attachedNote('http://127.0.0.1:9222')).toContain('繋いだ');
  });

  it('自分で起こしたなら、何も言わない', () => {
    expect(attachedNote(undefined)).toBeUndefined();
  });
});
