import { execFileSync } from 'node:child_process';

import type { ImageTools } from '@git-qa/core';

/**
 * webp にする道具を探す（2026-09-11・人の指示で webp 出力を入れた）。
 *
 * **前提を増やさない。**在れば使い、無ければ撮れた形のまま置く。
 * macOS の `sips` は webp を**書けない**ので、外の道具でしか作れない
 * （`sips --formats` に `Writable` が付いていない・実測）。
 *
 * **こちらから入れさせない。**案内には「あると webp になる」とだけ書く。
 */
export function pickImageTools(find: (name: string) => string | undefined): ImageTools {
  const cwebp = find('cwebp');
  const ffmpeg = find('ffmpeg');
  return {
    ...(cwebp === undefined ? {} : { cwebp }),
    ...(ffmpeg === undefined ? {} : { ffmpeg }),
  };
}

/** PATH から探す。**見つからないのは普通のこと**なので、黙って `undefined`。 */
export function whichTool(name: string): string | undefined {
  try {
    const found = execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim();
    return found === '' ? undefined : found;
  } catch {
    return undefined;
  }
}

/** 探し終えた道具。**起動のたびに 1 度だけ数える。** */
export const imageTools = (): ImageTools => pickImageTools(whichTool);
