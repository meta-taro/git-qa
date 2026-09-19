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

/** `git-qa-ios` を探す。**無ければ iPhone / iPad は見られない**（代わりの道が無い）。 */
export async function findIosTool(fromDir = here()): Promise<string | undefined> {
  return process.env['GIT_QA_IOS'] ?? (await found(candidates('git-qa-ios', fromDir)));
}

/** `git-qa-ocr` を探す。**無ければ文字が読めない**（映像は出る）。 */
export async function findOcrTool(fromDir = here()): Promise<string | undefined> {
  return process.env['GIT_QA_OCR'] ?? (await found(candidates('git-qa-ocr', fromDir)));
}
