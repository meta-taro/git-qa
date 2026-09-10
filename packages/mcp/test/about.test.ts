import { describe, expect, it } from 'vitest';

import { parseChangelog, renderAbout } from '../src/about.js';

/**
 * **AI エージェントへ、この道具の説明を渡す口**（2026-09-10・人の指示）。
 *
 * > MCP にこのソフト概要みたいなのを AI エージェント向けに出力するやつ設置したいです。
 * > バージョンごとになにが変わったかも返すように。
 *
 * **概要も変更履歴も、文書を正本にして読み出す。**TS に文字列を埋めると、
 * 文書と実装がずれる（product-baseline §10「古い文書は、無い文書より悪い」）。
 */
const CHANGELOG = `# 変更の記録

## 未リリース

- 足した: 概要を返す口
- 直した: 押した操作を黙って捨てていた

## 0.1.0 — 2026-09-08

- 足した: ウェブ検証
`;

describe('parseChangelog', () => {
  it('版ごとに、日付と中身を読む', () => {
    expect(parseChangelog(CHANGELOG)).toEqual([
      {
        version: '未リリース',
        changes: ['足した: 概要を返す口', '直した: 押した操作を黙って捨てていた'],
      },
      { version: '0.1.0', date: '2026-09-08', changes: ['足した: ウェブ検証'] },
    ]);
  });

  it('新しい順のまま返す（並べ替えない）', () => {
    const [first] = parseChangelog(CHANGELOG);

    expect(first?.version).toBe('未リリース');
  });

  /** **無いものを作らない。**空の記録から、それらしい版をでっち上げない。 */
  it('版が 1 つも無ければ、空を返す', () => {
    expect(parseChangelog('# 変更の記録\n\nまだ何も無い。\n')).toEqual([]);
  });
});

describe('renderAbout', () => {
  const brief = '# git-qa とは\n\n人と AI で動作検証をする道具。\n';

  it('概要をそのまま含める（要約しない）', () => {
    const text = renderAbout({ brief, changelog: CHANGELOG });

    expect(text).toContain('人と AI で動作検証をする道具。');
  });

  it('版ごとの変更を並べる', () => {
    const text = renderAbout({ brief, changelog: CHANGELOG });

    expect(text).toContain('0.1.0');
    expect(text).toContain('足した: ウェブ検証');
  });

  it('版を 1 つ指すと、その版だけを返す', () => {
    const text = renderAbout({ brief, changelog: CHANGELOG, version: '0.1.0' });

    expect(text).toContain('足した: ウェブ検証');
    expect(text).not.toContain('概要を返す口');
  });

  /** **知らない版を聞かれたら、そう言う。**黙って全部返すと、聞いた側が誤る。 */
  it('知らない版を聞かれたら、無いと言う', () => {
    const text = renderAbout({ brief, changelog: CHANGELOG, version: '9.9.9' });

    expect(text).toContain('9.9.9');
    expect(text).toContain('記録が無い');
  });

  /** **記録が読めなくても、概要は返す。**片方が欠けても、もう片方は渡す。 */
  it('変更の記録が無くても、概要は返す', () => {
    const text = renderAbout({ brief, changelog: undefined });

    expect(text).toContain('人と AI で動作検証をする道具。');
    expect(text).toContain('変更の記録が読めなかった');
  });
});
