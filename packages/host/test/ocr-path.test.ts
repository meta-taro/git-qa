import { describe, expect, it } from 'vitest';

import { join } from 'node:path';

import { inputCandidates, ocrCandidates, recordCandidates } from '../src/ocr-path.js';

/**
 * **区切りは OS が決める。**`/app/resources/git-qa-ocr` と直書きすると Windows で落ちる
 * （2026-09-11・Windows 版を初めて建てて分かった）。
 * 見たいのは**どの名前をどの順で探すか**であって、区切りが `/` か `\` かではない。
 */
const AT = '/app/resources';

/**
 * **2026-09-07 に気づいた。**
 *
 * Electron で作られたデスクトップアプリは、絵から文字を読む道具（段 2）が無いと**何も読めない**。
 * ところが `pnpm run:sheet:desktop` は `GIT_QA_OCR` を渡されたときしか使っていなかった。
 * **試験運用で渡した人は、環境変数のことを知らない。**黙って段 1 だけで動き、
 * 何も読めないまま全部 FAIL になる。
 */
describe('ocrCandidates', () => {
  it('配布物の隣を先に見る（そこに同梱してある）', () => {
    const [first] = ocrCandidates(AT);

    expect(first).toBe(join(AT, 'git-qa-ocr'));
  });

  it('手元で動かしたときの置き場所も見る', () => {
    const paths = ocrCandidates('/repo/packages/host/src');

    expect(
      paths.some((p) =>
        p.endsWith(join('packages', 'desktop', 'src-tauri', 'resources', 'git-qa-ocr')),
      ),
    ).toBe(true);
  });

  it('同じ場所を二度見に行かない', () => {
    const paths = ocrCandidates('/x/y');

    expect(new Set(paths).size).toBe(paths.length);
  });
});

/**
 * 画面を触る道具（`git-qa-input`）。
 *
 * **無いと、押すたびに相手が前面へ出る**（2026-09-07 の指摘）。
 * OCR と同じで、**環境変数を知らない人でも見つかる形**にしておく。
 */
describe('inputCandidates', () => {
  it('配布物の隣を先に見る', () => {
    expect(inputCandidates(AT)[0]).toBe(join(AT, 'git-qa-input'));
  });

  it('手元で建てたときの置き場所も見る', () => {
    const paths = inputCandidates('/repo/packages/host/src');

    expect(
      paths.some((p) =>
        p.endsWith(join('adapter-desktop', 'tools', 'input', 'target', 'release', 'git-qa-input')),
      ),
    ).toBe(true);
  });

  it('同じ場所を二度見に行かない', () => {
    const paths = inputCandidates('/x/y');

    expect(new Set(paths).size).toBe(paths.length);
  });
});

/**
 * 窓を録る道具（`git-qa-record`）を探す。
 *
 * **録るのは git-qa の窓**（2026-09-11・人の判断）。
 * そこには人が見たものが全部入っている —— ライブ映像、いま何を判定しているか、
 * AI が何と言ったか、矢印がどこを指していたか。
 */
describe('recordCandidates', () => {
  it('配布物の隣を先に見る', () => {
    expect(recordCandidates(AT)[0]).toBe(join(AT, 'git-qa-record'));
  });

  it('手元で建てたときの置き場所も見る', () => {
    expect(
      recordCandidates('/repo/packages/host/src').some((p) =>
        p.endsWith(join('desktop', 'src-tauri', 'resources', 'git-qa-record')),
      ),
    ).toBe(true);
  });

  /** **同じ場所を 2 回見に行かない。**（配布物では 2 つが同じ所を指す） */
  it('同じ場所は 1 度だけ', () => {
    const paths = recordCandidates(AT);

    expect(new Set(paths).size).toBe(paths.length);
  });
});
