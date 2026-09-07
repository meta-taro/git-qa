import { describe, expect, it } from 'vitest';

import { VERDICT_KEYS, verdictKeyHint } from '../../src/session/verdict-keys.js';

/**
 * **2026-09-07、人に間違ったキーを案内した。**
 *
 * 実行器がターミナルへ出していたのは `v=VERIFIED / f=FAIL / b=BLOCKED / s=SKIP`。
 * **実際の割り当ては `d` / `f` / `a` / `s`。**手で書いた案内が、実装から離れていた。
 *
 * 画面側には「割り当ての正本。画面へ出す説明もここから作る」と書いてあったのに、
 * **ターミナルへ出す説明だけが、その正本を通っていなかった。**
 */
describe('verdictKeyHint', () => {
  it('割り当てから作る（手で書かない）', () => {
    const hint = verdictKeyHint();

    for (const [key, result] of Object.entries(VERDICT_KEYS)) {
      expect(hint).toContain(`${key}=${result}`);
    }
  });

  it('置かずに次へ進む打鍵も案内する', () => {
    expect(verdictKeyHint()).toContain('Space');
  });

  it('合格は d（人が実物を見て置くもの）', () => {
    expect(VERDICT_KEYS['d']).toBe('VERIFIED');
  });
});
