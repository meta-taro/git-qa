import { parseWinWindows, pickWindow, whyUnusable, winArgs } from '@git-qa/adapter-desktop';

import type { CaptureMode, Screenshot } from './screen.js';

export interface WinCaptureOptions {
  /** `git-qa-win.exe` の場所。 */
  readonly toolPath: string;
  readonly run: (command: string, args: readonly string[]) => Promise<string>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly tmpPath: () => string;
}

/**
 * **Windows で、git-qa 自身の窓を撮る**（`app_screenshot`・2026-11-05 の報告）。
 *
 * macOS の口は `osascript` と `screencapture` を呼ぶので、Windows では何も撮れずに落ちていた。
 * Windows では窓も絵も `git-qa-win` の 1 本から取れる（窓の選び方はデスクトップ検証と同じ）。
 *
 * **画面全体は撮らない。**道具に画面全体を撮る口が無く、窓だけで用は足りる
 * （判定の欄・証跡の有無を見るのが目的）。頼まれたら、できないと言う。
 */
export function createWinWindowCapture(
  options: WinCaptureOptions,
): (app: string, mode?: CaptureMode) => Promise<Screenshot> {
  return async (app: string, mode: CaptureMode = 'window'): Promise<Screenshot> => {
    if (mode === 'screen') {
      throw new Error('Windows では画面全体は撮れない（窓だけ）。mode を window にするか省く');
    }

    const found = parseWinWindows(await options.run(options.toolPath, winArgs.windows(app)));
    const window = pickWindow(found, app);
    if (window === undefined) {
      // **黙って空の絵を返さない。**撮れなかったことと、何も出ていないことは別。
      throw new Error(`窓が見つからない: ${app}（起動しているかを確かめる）`);
    }
    const why = whyUnusable(window);
    if (why !== undefined) throw new Error(`「${app}」の${why}`);

    const path = options.tmpPath();
    await options.run(options.toolPath, winArgs.shot(window.hwnd, path));
    return {
      mimeType: 'image/png',
      base64: Buffer.from(await options.readFile(path)).toString('base64'),
    };
  };
}
