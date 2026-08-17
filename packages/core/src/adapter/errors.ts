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
