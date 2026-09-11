import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Screenshot } from '../adapter/types.js';

import { caseDir, caseDirName } from './layout.js';
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
}

/**
 * 拡張子は**アダプタが名乗った形**から作る。
 * いまは `png` しか無いが、**決め打ちにすると増えたときに黙って嘘になる。**
 */
const extensionOf = (format: string): string => format;

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

    const name = `screen.${extensionOf(shot.format)}`;
    await writeFile(join(dir, name), shot.bytes);

    // 証跡フォルダからの相対で残す。**読む人が動かしても辿れる。**
    return { state: 'saved', file: `${caseDirName(caseNo)}/${name}` };
  } catch (error: unknown) {
    // 握り潰さない。撮れなかったことと、撮らなかったことは別。
    return {
      state: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
