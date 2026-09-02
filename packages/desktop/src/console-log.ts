/**
 * 画面（webview）の中で起きたことを、Node 側のログへ流す。
 *
 * **これが無いと、映らない・動かないときに「人に聞く」しか手が無い。**
 * webview の console は誰も見ていない所へ出ていくので、開発の目が片方潰れている。
 *
 * **`attachConsole` ではない。**あれは「Rust のログを画面の console へ出す」もので、
 * 向きが逆（実際にこれを取り違えて、画面のエラーが一度も見えていなかった）。
 * ここでは console を包んで、プラグインの口へ送る。
 *
 * ブラウザで開いているとき（Tauri がいないとき）は何もしない。
 */
export async function attachConsoleToLog(): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  try {
    const log = await import('@tauri-apps/plugin-log');

    const forward =
      (level: (message: string) => Promise<void>, original: (...args: unknown[]) => void) =>
      (...args: unknown[]): void => {
        original(...args);
        // 送れなくても画面は動き続ける。**診断のために本筋を止めない。**
        void level(
          args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
        ).catch(() => undefined);
      };

    console.log = forward(log.info, console.log.bind(console));
    console.warn = forward(log.warn, console.warn.bind(console));
    console.error = forward(log.error, console.error.bind(console));

    // 拾い漏らさない。**握り潰された例外が、いちばん見えない。**
    window.addEventListener('error', (event) => {
      void log.error(`未捕捉のエラー: ${event.message}`).catch(() => undefined);
    });
    window.addEventListener('unhandledrejection', (event) => {
      void log.error(`未処理の失敗: ${String(event.reason)}`).catch(() => undefined);
    });

    await log.info('[git-qa] 画面のログを Node 側へ繋いだ');
  } catch (error: unknown) {
    // 繋げないこと自体は、人がやろうとしていることを妨げない。
    console.warn('[log] Node 側へ繋げない', error);
  }
}
