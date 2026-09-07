import { describe, expect, it } from 'vitest';

import { ocrCandidates } from '../src/ocr-path.js';

/**
 * **2026-09-07 に気づいた。**
 *
 * 連動くん（Electron）は、絵から文字を読む道具（段 2）が無いと**何も読めない**。
 * ところが `pnpm run:sheet:desktop` は `GIT_QA_OCR` を渡されたときしか使っていなかった。
 * **試験運用で渡した人は、環境変数のことを知らない。**黙って段 1 だけで動き、
 * 何も読めないまま全部 FAIL になる。
 */
describe('ocrCandidates', () => {
  it('配布物の隣を先に見る（そこに同梱してある）', () => {
    const [first] = ocrCandidates('/app/resources');

    expect(first).toBe('/app/resources/git-qa-ocr');
  });

  it('手元で動かしたときの置き場所も見る', () => {
    const paths = ocrCandidates('/repo/packages/host/src');

    expect(paths.some((p) => p.endsWith('packages/desktop/src-tauri/resources/git-qa-ocr'))).toBe(
      true,
    );
  });

  it('同じ場所を二度見に行かない', () => {
    const paths = ocrCandidates('/x/y');

    expect(new Set(paths).size).toBe(paths.length);
  });
});
