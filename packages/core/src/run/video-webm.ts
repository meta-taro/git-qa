import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { webmCommand } from '../adapter/to-webm.js';
import type { ImageTools } from '../adapter/to-webp.js';

/**
 * 撮れた動画を置く。**できれば webm、できなければ撮れた形のまま**（2026-09-11・人の指示）。
 *
 * **名前と中身を食い違わせない。**変換できなかったのに `.webm` を置くと、
 * **開けない証跡を「webm がある」と言う**ことになる。
 * 同じ日に、`png` と名乗って JPEG を渡していたのを直したばかり。
 *
 * **道具が無いことを理由に止めない。**webm は小さくなるだけで、
 * 証跡として要るのは**動画が残ること**の方。
 */

export interface SaveAsWebmOptions {
  /** 置き場所（ケースのフォルダ）。**動画はもうこの中に在る。** */
  readonly dir: string;
  /** いま在る動画のファイル名（`screen.mov` など）。 */
  readonly name: string;
  readonly tools: ImageTools;
  /** 外の道具を呼ぶ。**検査では差し替える。** */
  readonly run: (command: string, args: readonly string[]) => Promise<void>;
}

export interface SavedVideo {
  /** 実際に置いたファイル名。**中身と必ず一致する。** */
  readonly name: string;
  /** webm にできなかった理由。**できたときは持たない。** */
  readonly note?: string;
}

const WEBM = 'screen.webm';

export async function saveAsWebm(options: SaveAsWebmOptions): Promise<SavedVideo> {
  const { dir, name, tools, run } = options;
  if (name.endsWith('.webm')) return { name };

  const source = join(dir, name);
  const target = join(dir, WEBM);

  const command = webmCommand(tools, source, target);
  // 道具が無い。**撮れた形のまま置く**（失敗ではない）。
  if (command === undefined) return { name };

  try {
    await run(command.command, command.args);
  } catch (error: unknown) {
    return {
      name,
      note: `webm にできなかった: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // **出来ていることを見てから名乗る。**道具が何も言わずに何も作らないことがある。
  const made = await stat(target).catch(() => undefined);
  if (made === undefined || made.size === 0) {
    await rm(target, { force: true });
    return { name, note: 'webm にできなかった（道具は何も言わなかったが、出来ていない）' };
  }

  // 同じ動画が 2 つ残ると、どちらが証跡か分からない。
  await rm(source, { force: true });
  return { name: WEBM };
}
