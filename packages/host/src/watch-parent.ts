/**
 * 親（アプリ）が消えたことに気づく。
 *
 * **残ると端末を掴んだままになる。**実際に、数日前のものを含めて 12 個残っていた
 * （2026-09-04）。標準入力が閉じるのを待つだけでは足りない — 親が強く落とされたときや、
 * 別の親へ付け替えられたときに気づけない。**親の PID を見る。**
 *
 * macOS には Linux の `PDEATHSIG` に当たるものが無いので、こちらから見にいく。
 */
export interface WatchParentOptions {
  readonly intervalMs?: number;
  /** いまの親の PID。差し替え口（検査で使う）。 */
  readonly ppid?: () => number;
  readonly onOrphan: () => void;
}

/** 親が消えたら 1 度だけ呼ぶ。戻り値を呼べば見張りを止める。 */
export function watchParent(options: WatchParentOptions): () => void {
  const intervalMs = options.intervalMs ?? 5000;
  const ppid = options.ppid ?? ((): number => process.ppid);
  let fired = false;

  const timer = setInterval(() => {
    // 親が消えると init（1）へ付け替えられる。**それが「見捨てられた」印。**
    if (fired || ppid() !== 1) return;
    fired = true;
    options.onOrphan();
  }, intervalMs);
  // 見張りのせいでプロセスが終われなくなるのは本末転倒。
  timer.unref?.();

  return () => {
    clearInterval(timer);
  };
}
