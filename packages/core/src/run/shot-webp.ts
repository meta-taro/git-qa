import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Screenshot } from '../adapter/types.js';
import { webpCommand } from '../adapter/to-webp.js';
import type { ImageTools } from '../adapter/to-webp.js';

/**
 * 絵を置く。**できれば webp、できなければ撮れた形のまま**（2026-09-11・人の指示）。
 *
 * **名前と中身を食い違わせない。**変換に失敗したのに `.webp` を置くと、
 * 同じ日に直したばかりの嘘（`png` と名乗って JPEG を渡す）を、また作ることになる。
 *
 * **道具が無いことを理由に止めない。**webp は小さくなるだけで、
 * 証跡として要るのは**絵が残ること**の方。
 */

export interface SaveAsWebpOptions {
  /** 置き場所（ケースのフォルダ）。**呼び側が作っておく。** */
  readonly dir: string;
  readonly bytes: Uint8Array;
  readonly format: Screenshot['format'];
  readonly tools: ImageTools;
  /** 外の道具を呼ぶ。**検査では差し替える。** */
  readonly run: (command: string, args: readonly string[]) => Promise<void>;
}

export interface SavedShot {
  /** 実際に置いたファイル名。**中身と必ず一致する。** */
  readonly name: string;
  /** webp にできなかった理由。**できたときは持たない。** */
  readonly note?: string;
}

export async function saveAsWebp(options: SaveAsWebpOptions): Promise<SavedShot> {
  const { dir, bytes, format, tools, run } = options;

  // もう webp なら触らない（ウェブは CDP がそのまま出す）。
  if (format === 'webp') {
    await writeFile(join(dir, 'screen.webp'), bytes);
    return { name: 'screen.webp' };
  }

  const original = `screen.${format}`;
  const originalPath = join(dir, original);
  await writeFile(originalPath, bytes);

  const command = webpCommand(tools, originalPath, join(dir, 'screen.webp'));
  // 道具が無い。**撮れた形のまま置く**（失敗ではない）。
  if (command === undefined) return { name: original };

  try {
    await run(command.command, command.args);
  } catch (error: unknown) {
    // **変換できなかったことを黙らない。**置いたのは元の形のまま。
    return {
      name: original,
      note: `webp にできなかった: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // 変換できたので、元の形は残さない（同じ絵が 2 つ残ると、どちらが証跡か分からない）。
  await rm(originalPath, { force: true });
  return { name: 'screen.webp' };
}
