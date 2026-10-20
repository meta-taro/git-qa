import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

import type { Screenshot } from './tools.js';

const EXTENSION: Record<Screenshot['mimeType'], string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/** 同じ形の別の綴り。`.jpeg` と書いても JPEG は JPEG。 */
const ALSO: Record<string, string> = { '.jpeg': '.jpg' };

/**
 * **撮った画面を、名前を付けて残す**（2026-10-20）。書いた場所（絶対パス）を返す。
 *
 * 証跡にするために、AI の道具の一時フォルダから画像を探してコピーしていた。
 *
 * - 相対の場所は `base`（既定は MCP を起こした所）から数える。無いフォルダは作る
 * - 拡張子が無ければ中身の形に合わせて付ける。**違えば書かない**（JPEG を .png と名乗らせない）
 * - **もう在るファイルには書かない**（証跡を黙って上書きしない）
 */
export async function saveShot(
  shot: Screenshot,
  path: string,
  base: string = process.cwd(),
): Promise<string> {
  const want = EXTENSION[shot.mimeType];
  const said = extname(path).toLowerCase();
  const named = said === '' ? `${path}${want}` : path;
  if (said !== '' && (ALSO[said] ?? said) !== want) {
    throw new Error(
      `画面の絵は ${shot.mimeType} なので、名前の拡張子を ${want} にしてください（${path}）`,
    );
  }
  const target = resolve(base, named);
  await mkdir(dirname(target), { recursive: true });
  try {
    // **黙って上書きしない。**在れば 'wx' が EEXIST で落ちる。
    await writeFile(target, Buffer.from(shot.base64, 'base64'), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`そこにはもう在るので書かない（${target}）。別の名前を渡してください`);
    }
    throw error;
  }
  return target;
}
