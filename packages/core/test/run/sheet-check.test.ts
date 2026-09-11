import { describe, expect, it } from 'vitest';

import { compareSheet, sheetDigest } from '../../src/run/sheet-check.js';

/**
 * **証跡が何に対して置かれたのかを、後から確かめる。**
 *
 * 外部のレビューで指摘を受けた（meta-taro/git-qa#1・2026-09-11）。
 *
 * > シートの `sha256` は毎回書かれているが、読む側がどこにも無い。
 * > 検出は「原理的には可能」であって、**何も検出していません**。
 *
 * 実際、書く側は 4 箇所あるのに、突き合わせる本番コードは 0 件だった。
 * **`VERIFIED` は署名であってロックではない**（README）。だとすれば、
 * **署名が何に対して置かれたのかが動かないこと**が要る。
 */
const TEXT = '#! md-business:test-spec-tsv/v1\nNo.\t項目\n1\tあ\n';

describe('sheetDigest', () => {
  it('書く側と同じ数え方をする（64 文字の 16 進）', () => {
    expect(sheetDigest(TEXT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('1 文字違えば別の値になる', () => {
    expect(sheetDigest(TEXT)).not.toBe(sheetDigest(`${TEXT} `));
  });
});

describe('compareSheet', () => {
  it('同じなら「同じ」と言う', () => {
    const result = compareSheet({ sha256: sheetDigest(TEXT), path: 'a.tsv' }, TEXT);

    expect(result.kind).toBe('same');
  });

  /** **変わったことを、黙って通さない。**判定は別の文面に対して置かれている。 */
  it('変わっていたら、変わったと言う', () => {
    const result = compareSheet({ sha256: sheetDigest(TEXT), path: 'a.tsv' }, `${TEXT}2\tい\n`);

    expect(result.kind).toBe('changed');
    expect(result.reason).toContain('変わって');
    // **どちらの値かを出す。**出さないと、読んだ人が自分で数え直すことになる。
    expect(result.reason).toContain(sheetDigest(TEXT).slice(0, 12));
  });

  /** シートが消えていることと、変わっていることは別。**同じ扱いにしない。** */
  it('シートが読めなければ、そう言う', () => {
    const result = compareSheet({ sha256: sheetDigest(TEXT), path: 'a.tsv' }, undefined);

    expect(result.kind).toBe('missing');
    expect(result.reason).toContain('a.tsv');
  });

  /**
   * **記録されたハッシュが壊れていることもある。**
   * 手で書き換えられた証跡を「同じ」と言わない。
   */
  it('記録されたハッシュの形がおかしければ、そう言う', () => {
    const result = compareSheet({ sha256: 'not-a-hash', path: 'a.tsv' }, TEXT);

    expect(result.kind).toBe('unreadable');
    expect(result.reason).toContain('not-a-hash');
  });
});
