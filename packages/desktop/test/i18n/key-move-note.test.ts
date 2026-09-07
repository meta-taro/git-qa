import { describe, expect, it } from 'vitest';

import { MESSAGES } from '../../src/i18n/index.js';

/**
 * **2026-09-07、人に言われた。**
 *
 * > 一回合格にすると不合格にできない。ほかのケースもないかチェックがひつよう
 *
 * **置き直しはできる**（`session/cursor.ts` と `host/run-session.ts` の `revise`、
 * どちらも検査してある）。**画面の説明が嘘だった。**
 * 「見るだけ。判定は動かない」と書いてあれば、置き直せないと読む。
 *
 * **できることを「できない」と書かない。**
 */
describe('↑ ↓ の説明', () => {
  it('置き直せることが読み取れる', () => {
    const note = MESSAGES.ja['key.move.note'];

    expect(note).toContain('置き直');
    expect(note).not.toContain('判定は動かない');
  });
});
