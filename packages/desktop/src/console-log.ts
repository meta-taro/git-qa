/**
 * 画面（webview）の中で起きたことを、Node 側のログへ流す。
 *
 * **これが無いと、映らない・動かないときに「人に聞く」しか手が無い。**
 * webview の console は誰も見ていない所へ出ていくので、開発の目が片方潰れている。
 *
 * ブラウザで開いているとき（Tauri がいないとき）は何もしない。
 */
export async function attachConsoleToLog(): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  try {
    const { attachConsole } = await import('@tauri-apps/plugin-log');
    await attachConsole();
  } catch (error: unknown) {
    // 繋げないこと自体は、人がやろうとしていることを妨げない。
    console.warn('[log] Node 側へ繋げない', error);
  }
}
