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

/**
 * **押せる名前を並べる**（2026-09-19・MCP 拡充）。
 *
 * `observe()` は既に段 1（AX）の要素を持っている。**MCP が出していなかっただけ。**
 *
 * **契約は 1 つ。ここに並んだものは、そのまま `element_tap` に渡せる。**
 * `findInElements` が当てにいくのは**名前**なので、名前だけを並べる。
 *
 * **段 1 が空でも落ちない。**絵からしか読めない相手は普通にある
 * （Electron は聞かれるまで木を作らない・C57）。そのときは空。
 */
export function elementNamesOf(observation: { readonly raw: unknown }): string[] {
  const raw = observation.raw;
  if (typeof raw !== 'object' || raw === null) return [];
  const elements = (raw as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return [];

  const out: string[] = [];
  for (const element of elements) {
    if (typeof element !== 'object' || element === null) continue;
    const name = (element as { name?: unknown }).name;
    if (typeof name !== 'string') continue;
    const said = name.trim();
    if (said !== '' && !out.includes(said)) out.push(said);
  }
  return out;
}

/** 繋いだセッションから、**押せる名前**を取る。 */
export async function listDesktopElements(session: TargetSession): Promise<string[]> {
  return elementNamesOf(await session.observe());
}
