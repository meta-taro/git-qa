/**
 * アダプタの操作に失敗したときのエラー。
 *
 * 対象の種類を必ず添える。実行中は複数の相手（機体・ブラウザ）に繋ぐことがあり、
 * どの相手で落ちたかが無いと、ログだけ見ても切り分けられない。
 */
export class AdapterError extends Error {
  override readonly name = 'AdapterError';

  readonly kind: string;

  constructor(kind: string, message: string) {
    super(`[${kind}] ${message}`);
    this.kind = kind;
  }
}

/**
 * **人へ見せる文にする。**先頭に付いている `[android]` のような内部の印を落とす。
 *
 * 実物を使った人が画面で見た文（2026-09-04）:
 * `ライブ映像を出せない: [android] screenrecord が映像を 1 枚も返さずに終わった`
 *
 * 対象の種類は**ログでは要る**（複数の相手に繋ぐので、どれで落ちたかが要る）。
 * **画面では読む人の邪魔にしかならない。**だから消すのではなく、出す直前に落とす。
 *
 * 文の途中の `[ ]` は落とさない（`画面に見つからない要素: [保存]` を削らないため）。
 */
export function humanMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^\[[^\]]+\]\s*/, '');
}
