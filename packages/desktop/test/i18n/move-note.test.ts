import { describe, expect, it } from 'vitest';

import { MESSAGES } from '../../src/i18n/index.js';

/**
 * **2026-09-07、人に 2 度言われた。**
 *
 * > ひとつしたまでしかいかないね。
 * > した矢印おしても、したまでいかないね。これりょうほうなおってないよ。
 *
 * 1 度目は説明だけを直した。**動きは直していなかったので、直っていない。**
 * 見るのと置くのは別で、**見るのは全部許す**ことにした（`session/cursor.ts`）。
 * 説明も、そこに合わせる。
 */
describe('↑ ↓ の説明', () => {
  it('見る場所が動くことを言う', () => {
    expect(MESSAGES.ja['key.move.note']).toContain('見る場所');
  });

  it('置き直せることも、同じ行で分かる', () => {
    expect(MESSAGES.ja['key.move.note']).toContain('置き直');
  });

  it('「走り終わったケースまでしか行けない」とは書かない（もうそうではない）', () => {
    expect(MESSAGES.ja['key.move.note']).not.toContain('だけを行き来');
  });
});
