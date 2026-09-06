import type { TargetSession } from '@git-qa/core';

/**
 * 繋いだセッションから、**画面で読める文字**を取る。
 *
 * **段 1 と段 2 の両方を並べたもの**を使う（`adapter.ts` の `screenTextOf`）。
 * 片方だけだと取りこぼす —— Tauri は AX に 8 個しか出さないが、絵からは 29 行読めた
 * （2026-09-06 実測）。
 */
export async function readDesktopScreenText(session: TargetSession): Promise<string> {
  const observation = await session.observe();
  const raw = observation.raw as { text?: unknown } | null;
  if (typeof raw?.text !== 'string') {
    // 握り潰さない。読めないまま空文字を返すと、期待結果が「無い」ことになり FAIL が積む。
    throw new Error('画面の生データに、読める文字が入っていない');
  }
  return raw.text;
}
