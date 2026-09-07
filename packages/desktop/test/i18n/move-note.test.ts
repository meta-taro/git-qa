import { describe, expect, it } from 'vitest';

import { MESSAGES } from '../../src/i18n/index.js';

/**
 * **2026-09-07、人に言われた。**
 *
 * > ひとつしたまでしかいかないね。
 *
 * 仕様どおり（走り終わったケースの中だけを行き来する）。**その断りが画面に無い。**
 * 「次のケースを見る」としか書いていなければ、**全部を見られると読む。**
 * できないことは、できないと書く。
 */
describe('↑ ↓ の説明', () => {
  it('走り終わったケースまでしか行けないことが読み取れる', () => {
    const note = MESSAGES.ja['key.move.note'];

    expect(note).toContain('走り終わった');
  });

  it('置き直せることも、同じ行で分かる', () => {
    expect(MESSAGES.ja['key.move.note']).toContain('置き直');
  });
});
