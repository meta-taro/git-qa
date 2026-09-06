import { describe, expect, it } from 'vitest';

import type { Observation, TargetSession } from '@git-qa/core';

import { readWebScreenText } from '../src/screen-text.js';

/**
 * 画面で読める文字を取る。期待結果（「〜と表示される」）との突き合わせに使う。
 *
 * **ブラウザに聞く。**HTML から自分で剥がすと、`<script>` の中身や
 * `display: none` の文字まで「表示されている」ことになり、**通ってはいけないケースが通る。**
 * 検証の道具でいちばん高くつくのは、偽の合格。
 */

const sessionWith = (raw: unknown): TargetSession =>
  ({
    observe: () =>
      Promise.resolve({ kind: 'web', capturedAt: '2026-09-06T00:00:00.000Z', raw } as Observation),
  }) as unknown as TargetSession;

describe('readWebScreenText', () => {
  it('ブラウザが出した「読める文字」を返す', async () => {
    const session = sessionWith({ html: '<html>…</html>', text: '保存しました\n次へ' });

    await expect(readWebScreenText(session)).resolves.toBe('保存しました\n次へ');
  });

  /**
   * **握り潰さない。**読めないまま空文字を返すと、期待結果が「無い」ことになり
   * FAIL が積み上がる（Android 側と同じ理由）。
   */
  it('形が違ったら、そう言って落ちる（空文字を返さない）', async () => {
    await expect(readWebScreenText(sessionWith('<html>…</html>'))).rejects.toThrow(/読める文字/);
    await expect(readWebScreenText(sessionWith({ html: 'x' }))).rejects.toThrow(/読める文字/);
  });
});
