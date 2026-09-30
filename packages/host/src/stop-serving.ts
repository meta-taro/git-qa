/**
 * **`--serve` を止める。必ず終わる**（meta-taro/git-qa#34・2026-09-30 の報告）。
 *
 * アプリを SIGTERM で止めたら、host だけが親を失って**一晩中動き続けた。**
 * 見張り（`watchParent`）は付いていたが、止める処理が 2 つの形で終わらなかった。
 *
 * 1. 実行が動いていない（session が無い）と、`session?.close().finally(exit)` は
 *    **式ごと空になり、exit が呼ばれなかった**
 * 2. 後片付けが返らないと、**いつまでも待っていた**（見張りは 1 回しか呼ばない）
 *
 * 後片付けは試みる。**済んでも、落ちても、上限が来ても終わる。**
 */
export interface StopServingOptions {
  readonly session: { close(): Promise<void> } | undefined;
  readonly exit: (code: number) => void;
  /** 後片付けを待つ上限。**これを過ぎたら、済んでいなくても終わる。** */
  readonly timeoutMs?: number;
}

export async function stopServing(options: StopServingOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  // 落ちても終わる。**片付けに失敗したことで、残り続ける理由にしない。**
  const closing = (options.session?.close() ?? Promise.resolve()).catch((error: unknown) => {
    console.error('[git-qa] 止める前の後片付けに失敗した:', error);
  });
  await Promise.race([closing, limit]);
  if (timer !== undefined) clearTimeout(timer);
  options.exit(0);
}
