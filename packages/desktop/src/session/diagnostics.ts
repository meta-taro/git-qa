/**
 * 画面の中の様子を、外から読めるようにする。
 *
 * **「映っていますか」と人に聞かないと分からない状態を減らす**のが目的。
 * 復号した枚数・描いた枚数・最後の失敗を置いておけば、
 * 「繋がっていない」のか「復号で落ちている」のか「描いているが見えない」のかを切り分けられる。
 */

export interface DiagnosticsReport {
  /** 復号できた枚数。 */
  readonly decoded: number;
  /** canvas へ描いた枚数。 */
  readonly drawn: number;
  /** いまの canvas の大きさ（端末の実寸に合わせて変わる）。 */
  readonly canvas?: { readonly width: number; readonly height: number };
  /** 最後に起きた失敗。**握り潰さずここへ出す。** */
  readonly lastError?: string;
  /** 画面がどの URL を開いているか。**`?live=` が渡っているかを外から確かめられる。** */
  readonly href?: string;
  /** この webview が H.264 を復号できるか。 */
  readonly canDecode?: boolean;
  /** 映像の口から受け取ったバイト数。**0 なら橋まで届いていない。** */
  readonly bytes?: number;
  /** 復号器が落ちた理由。**bytes は増えているのに decoded が 0 なら、ここを見る。** */
  readonly decodeError?: string;
  /** 実際に使った codec。端末の SPS から組み立てたもの。 */
  readonly codec?: string;
  /**
   * 最後に canvas へ描いた時刻（epoch ms）。
   *
   * **操作した時刻と引き算すれば、端から端までの遅れが出る**（Issue 005）。
   * 同じ PC の中なので、時計は揃っている。
   */
  readonly lastFrameAt?: number;
}

/**
 * 診断の口へ送る。**送れなくても落とさない**（診断のために本筋を止めない）。
 */
export async function reportDiagnostics(
  controlUrl: string,
  report: DiagnosticsReport,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl(`${controlUrl}/diag`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch {
    // 診断が送れないこと自体は、人がやろうとしていることを妨げない。
  }
}
