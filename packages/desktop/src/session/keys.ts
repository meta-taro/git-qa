import type { HumanResult } from '@git-qa/core/session';

import type { MessageKey } from '../i18n/index.js';

/**
 * 人が押すキー。**1 打鍵で置いて、次へ進む**（C6）。
 *
 * Enter も修飾キーも要求しない。要求すると、見ながら押す動作が 2 手になり、
 * 「見た人がその場で置く」という前提が崩れる。
 * 逆に、**修飾キー付きの打鍵は受け取らない。**OS や webview の操作（⌘Q・⌘R）を奪うと、
 * 人が画面から出られなくなる。
 */

export interface KeyPress {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

export type KeyCommand =
  | { readonly kind: 'verdict'; readonly humanResult: HumanResult }
  /** 置かずに次へ。**繰り上げない**ので結果は `AUTO_PASS` になる。 */
  | { readonly kind: 'advance' };

/** 割り当ての正本。**画面へ出す説明もここから作る**ので、説明と実装がずれない。 */
export const KEY_BINDINGS: readonly { readonly key: string; readonly labelKey: MessageKey }[] = [
  { key: 'v', labelKey: 'key.verified' },
  { key: 'f', labelKey: 'key.fail' },
  { key: 'b', labelKey: 'key.blocked' },
  { key: 's', labelKey: 'key.skip' },
  { key: ' ', labelKey: 'key.advance' },
];

const VERDICTS: Readonly<Record<string, HumanResult>> = {
  v: 'VERIFIED',
  f: 'FAIL',
  b: 'BLOCKED',
  s: 'SKIP',
};

export function commandForKey(press: KeyPress): KeyCommand | undefined {
  if (press.ctrlKey === true || press.metaKey === true || press.altKey === true) return undefined;

  // Shift を押したまま打っても効くようにする。押し直させない。
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key;

  const humanResult = VERDICTS[key];
  if (humanResult !== undefined) return { kind: 'verdict', humanResult };
  if (key === ' ') return { kind: 'advance' };
  // **取り消し（u）はまだ無い。**確定したケースをコア側で開け直す仕組みが要る。
  // 割り当てだけ先に作ると、押しても何も起きないキーになる。
  return undefined;
}
