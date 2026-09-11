import { mkdir } from 'node:fs/promises';

import type { Screenshot } from '../adapter/types.js';
import type { ImageTools } from '../adapter/to-webp.js';

import { caseDir, caseDirName } from './layout.js';
import { saveAsWebp } from './shot-webp.js';
import type { CaseScreenshot } from './types.js';

/**
 * **判定を置く時点の画面を残す**（2026-09-11・人の指示）。
 *
 * > 人はぼーっとみながら AI のテストを鑑賞します。
 * > そのときに AI がわは、テスト判定のキャプチャと、動画をとっていきます。
 *
 * それまで証跡フォルダには `run.json` しか無かった（実測。10 件の実行すべて）。
 * **「あとで見直す」と言っていた材料が、1 枚も残っていなかった。**
 *
 * **撮れなかったときは、撮らなかったのか失敗したのかを分ける**（`recording` と同じ考え方）。
 * 黙って空にすると、読む人は「そういう実行だった」と受け取ってしまう。
 */

/** 撮る口だけを借りる。**セッション全部を知らなくてよい。** */
type Shooter = { screenshot?: () => Promise<Screenshot> };

export interface CaptureCaseShotOptions {
  readonly session: Shooter;
  /** 証跡の置き場所。**無ければ撮らない**（失敗ではない）。 */
  readonly runsRoot?: string;
  readonly runId: string;
  readonly caseNo: number;
  /**
   * webp にする道具の場所。**無ければ、撮れた形のまま置く**（2026-09-11）。
   * `sips` は webp を書けないので、外の道具が要る。
   */
  readonly tools?: ImageTools;
  /** 外の道具を呼ぶ。**検査では差し替える。** */
  readonly run?: (command: string, args: readonly string[]) => Promise<void>;
}

export async function captureCaseShot(options: CaptureCaseShotOptions): Promise<CaseScreenshot> {
  const { session, runsRoot, runId, caseNo } = options;

  // **置き場所が無いなら、撮らない。**呼び側が渡していないだけで、失敗ではない。
  if (runsRoot === undefined) return { state: 'not_requested' };

  if (session.screenshot === undefined) {
    return { state: 'unsupported', reason: 'この相手は画面を撮る口を持っていない' };
  }

  try {
    const shot = await session.screenshot();
    const dir = caseDir(runsRoot, runId, caseNo);
    await mkdir(dir, { recursive: true });

    // **できれば webp、できなければ撮れた形のまま。**名前と中身は必ず一致する。
    const saved = await saveAsWebp({
      dir,
      bytes: shot.bytes,
      format: shot.format,
      tools: options.tools ?? {},
      run: options.run ?? runTool,
    });

    // 証跡フォルダからの相対で残す。**読む人が動かしても辿れる。**
    return { state: 'saved', file: `${caseDirName(caseNo)}/${saved.name}` };
  } catch (error: unknown) {
    // 握り潰さない。撮れなかったことと、撮らなかったことは別。
    return {
      state: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 外の道具を 1 つ呼ぶ。**出た文字はそのまま理由に載せる。** */
async function runTool(command: string, args: readonly string[]): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await promisify(execFile)(command, [...args]);
}
