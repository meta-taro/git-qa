import type { HumanResult } from '../run/types.js';

/**
 * 人が押すキーと、置かれる結果。**ここが正本。**
 *
 * 画面（webview）もターミナルの案内も、ここから作る。
 * 2026-09-07、実行器のターミナル案内だけが手書きのままずれていて、
 * **人に押せないキー（`v` / `b`）を案内した。**説明を手で書かない。
 */
export const VERDICT_KEYS: Readonly<Record<string, HumanResult>> = {
  d: 'VERIFIED',
  f: 'FAIL',
  a: 'BLOCKED',
  s: 'SKIP',
};

/** ターミナルへ出す 1 行。**割り当てから作る。** */
export function verdictKeyHint(): string {
  const placed = Object.entries(VERDICT_KEYS)
    .map(([key, result]) => `${key}=${result}`)
    .join(' / ');
  return `${placed} / Space=置かずに次へ`;
}
