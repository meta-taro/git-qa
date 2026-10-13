import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * iPhone / iPad を映す道具（`git-qa-ios`）と、絵から文字を読む道具（`git-qa-ocr`）を探す。
 *
 * **宿主（`@git-qa/host`）に同じ探し方がある。**ここで写しているのは、
 * **MCP が宿主に依存していない**ため（MCP は端末を触る最小の口で、実行器を持たない）。
 * **3 か所目が要るようになったら 1 本にまとめる** —— いまはまだ重複が本物ではない。
 */
const here = (): string => dirname(fileURLToPath(import.meta.url));

const found = async (paths: readonly string[]): Promise<string | undefined> => {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // ここには無い。次を見る。**無いこと自体は普通**（macOS 以外・建てる前）。
    }
  }
  return undefined;
};

/** 建てた道具の置き場所。**手元（repo）と、配布物の中。** */
const candidates = (name: string, fromDir: string): string[] => [
  join(fromDir, name),
  resolve(fromDir, '..', '..', 'desktop', 'src-tauri', 'resources', name),
];

/**
 * `git-qa-ios` を探す。無ければ USB では見られない（口＝WebDriverAgent があれば口だけで動く）。
 *
 * **macOS 以外では探さない**（2026-10-13）。道具は repo に入っていて Windows の clone にも在り、
 * 在るだけで返すと起こせずに終わった（宿主の `findIos` と同じ直し）。
 */
export async function findIosTool(
  fromDir = here(),
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const fromEnv = env['GIT_QA_IOS'];
  if (fromEnv !== undefined) return fromEnv;
  if (platform !== 'darwin') return undefined;
  return found(candidates('git-qa-ios', fromDir));
}

/** `git-qa-ocr` を探す。**無ければ文字が読めない**（映像は出る）。 */
export async function findOcrTool(fromDir = here()): Promise<string | undefined> {
  return process.env['GIT_QA_OCR'] ?? (await found(candidates('git-qa-ocr', fromDir)));
}
