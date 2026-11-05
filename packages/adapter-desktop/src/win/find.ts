import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Windows で窓を見る道具（`git-qa-win.exe`）を探す（2026-09-12）。
 *
 * macOS 側の 3 本（OCR / 触る / 録る）に当たるものが、Windows ではこれ 1 本。
 * **無ければデスクトップ検証が丸ごとできない** —— `git-qa-ocr` のような
 * 「あると良い」ではなく「**無いと何もできない**」。
 *
 * **探し方はここ 1 か所に置く。**画面から始める道（host）と MCP の道で別々に持っていたら、
 * MCP の道には無く、**Windows では MCP からデスクトップを見られなかった**（2026-11-05 の報告）。
 */
export function winToolCandidates(fromDir: string): string[] {
  const beside = join(fromDir, 'git-qa-win.exe');
  // 手元で建てたとき。`packages/<pkg>/src` から数えて、建てた先を見に行く。
  const inRepo = resolve(
    fromDir,
    '..',
    '..',
    'adapter-desktop',
    'tools',
    'win',
    'target',
    'release',
    'git-qa-win.exe',
  );
  return [...new Set([beside, inRepo])];
}

const isThere = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/** 実際にあるものを 1 つ返す。**無ければ undefined**（Windows ではデスクトップを見られない）。 */
export async function findWinTool(
  fromDir: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => Promise<boolean> = isThere,
): Promise<string | undefined> {
  const fromEnv = env['GIT_QA_WIN'];
  if (fromEnv !== undefined) return fromEnv;

  for (const path of winToolCandidates(fromDir)) {
    // 無ければ次を見る。**macOS では無いのが普通。**
    if (await exists(path)) return path;
  }
  return undefined;
}
