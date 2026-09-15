import { VERDICT_KEYS } from '@git-qa/core/session';
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
  | { readonly kind: 'advance' }
  /**
   * **鑑賞を止める**（2026-09-11・人の指示）。
   *
   * > 途中で止められる配慮も必要です。
   *
   * 押さなくても進むモードなので、**止める手が要る。**
   * 判定のキーは奪わない —— 止めるのは判定とは別の行い。
   */
  | { readonly kind: 'stop' }
  /**
   * **映像を拡大する**（外部レビュー meta-taro/git-qa#13）。
   *
   * > 見えない画面で押す `D` は、**AI の判定を追認しただけ**になりかねません。
   *
   * `by` は段の上げ下げ（`0` は等倍へ戻す）。**判定のキーは奪わない。**
   */
  | { readonly kind: 'zoom'; readonly by: 1 | -1 | 0 }
  /**
   * **相手の画素と 1 対 1 で見る**（外部レビュー meta-taro/git-qa#17）。
   *
   * > いまの `0` は「枠に合わせる」なので、別物として要るように思いました。
   *
   * 枠に合わせる（`0`）と、相手の画素に合わせる（`1`）は**狙いが別。**
   * 前者は全部を見るため、後者は**細部を本物の画素で見る**ため。
   */
  | { readonly kind: 'zoomPixels' }
  /** 見ているケースを前後に動かす。**実行の進行とは別のカーソル**（Issue 013）。 */
  | { readonly kind: 'prev' }
  | { readonly kind: 'next' };

/** 割り当ての正本。**画面へ出す説明もここから作る**ので、説明と実装がずれない。 */
export interface KeyBinding {
  readonly key: string;
  readonly labelKey: MessageKey;
  /** 証跡にどう残るか。**押す前に分かるようにする。** */
  readonly noteKey: MessageKey;
}

/**
 * 割り当ては **左手をホーム段（A S D F）に置いたまま動かさない**ことを前提にする
 * （2026-09-04・実物を触った人の指定）。
 *
 * ```
 *   a   s   d   f      Space
 *  小指 薬指 中指 人差指   親指
 * ```
 *
 * **内側 2 つ（`d` `f`）が「自分の目で見て決めた」、外側 2 つ（`a` `s`）が
 * 「決められなかった・見ない」。**
 *
 * `f` を合格にすると人差し指が最頻になって効率は良いが、**`f` の意味が
 * 「不合格 → 合格」へ反転する。**この製品でいちばん壊してはいけない値なので採らない。
 * 頭文字の対応（`f` = FAIL / `s` = SKIP）もそのまま残る。
 */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  { key: 'd', labelKey: 'key.verified', noteKey: 'key.verified.note' },
  { key: 'f', labelKey: 'key.fail', noteKey: 'key.fail.note' },
  { key: 'a', labelKey: 'key.blocked', noteKey: 'key.blocked.note' },
  { key: 's', labelKey: 'key.skip', noteKey: 'key.skip.note' },
  { key: ' ', labelKey: 'key.advance', noteKey: 'key.advance.note' },
  { key: 'ArrowUp', labelKey: 'key.prev', noteKey: 'key.move.note' },
  { key: 'ArrowDown', labelKey: 'key.next', noteKey: 'key.move.note' },
  // **見えないものに判定は置けない**（外部レビュー #13）。打鍵だけにしない。
  { key: '+', labelKey: 'key.zoomIn', noteKey: 'key.zoom.note' },
  { key: '-', labelKey: 'key.zoomOut', noteKey: 'key.zoom.note' },
  { key: '0', labelKey: 'key.zoomReset', noteKey: 'key.zoom.note' },
  // **押しても細部が増えない所がある**ので、狙える口を出しておく（#17）。
  { key: '1', labelKey: 'key.zoomPixels', noteKey: 'key.zoomPixels.note' },
];

const VERDICTS = VERDICT_KEYS;

export function commandForKey(press: KeyPress): KeyCommand | undefined {
  if (press.ctrlKey === true || press.metaKey === true || press.altKey === true) return undefined;

  // Shift を押したまま打っても効くようにする。押し直させない。
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key;

  const humanResult = VERDICTS[key];
  if (humanResult !== undefined) return { kind: 'verdict', humanResult };
  if (key === ' ') return { kind: 'advance' };
  if (key === 'Escape') return { kind: 'stop' };
  // 映像の拡大。**判定のキー（d/f/a/s）とスペースは奪っていない。**
  if (key === '+' || key === '=') return { kind: 'zoom', by: 1 };
  if (key === '-') return { kind: 'zoom', by: -1 };
  if (key === '0') return { kind: 'zoom', by: 0 };
  // **1 は「相手の画素と 1 対 1」。**0（枠に合わせる）とは別の狙い（#17）。
  if (key === '1') return { kind: 'zoomPixels' };
  // 一覧は縦に並んでいるので、左右でも上下でも動かせるようにする。
  if (key === 'ArrowLeft' || key === 'ArrowUp') return { kind: 'prev' };
  if (key === 'ArrowRight' || key === 'ArrowDown') return { kind: 'next' };
  // **取り消し（u）はまだ無い。**確定したケースをコア側で開け直す仕組みが要る。
  // 割り当てだけ先に作ると、押しても何も起きないキーになる。
  return undefined;
}

/**
 * その打鍵を、判定として扱わない場所か。
 *
 * **端末へ文字を送る欄に打った `v` が、判定になってはいけない。**
 * ボタンの上での Space も、押下と判定の二重取りになるので外す。
 */
export function shouldIgnoreKeyPress(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return true;
  return target.getAttribute('contenteditable') === 'true';
}

/**
 * 画面に出すキーの名前。
 *
 * **`ArrowUp` はブラウザの内部の名前**で、人に見せる名前ではない
 * （2026-09-07「あとあろうアプとかなぜえいごですか？記号ではだめなの？」）。
 * **キーボードに刻まれているものを出す。**
 */
const CAPS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': 'スペース',
  Escape: 'Esc',
  '+': '＋',
  '-': '−',
};

export function keyCap(key: string): string {
  return CAPS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}
