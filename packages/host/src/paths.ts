import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * 人が打った場所を基準にパスを解決する。
 *
 * **`pnpm --filter <pkg> exec ...` は作業ディレクトリをそのパッケージへ移す。**
 * 人はリポジトリのルートで打っているので、そのままだと検証シートも `runs/` も
 * 別の場所を指す（**実際にこれで動かなかった**）。pnpm は打った場所を `INIT_CWD` に入れる。
 */
export function fromInvocationDir(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  if (isAbsolute(path)) return path;
  return resolve(env['INIT_CWD'] ?? cwd, path);
}

/**
 * 証跡（`run.json`）の置き場。
 *
 * **書けない所へ書こうとしない。**Finder から `.app` を起動すると作業ディレクトリが `/` になり、
 * そのままだと `/runs` を作ろうとして落ちる。**5 件の判定を置いたあとに保存で落ちるのが、
 * いちばん高くつく壊れ方**（実際に起きた・2026-09-04）。
 *
 * 逃がし先は書類フォルダの下。**人が開けて、そのまま人へ渡せる所**に置く
 * （`~/Library/Application Support` は仕様どおりだが、証跡は人が探して添付するものなので採らない）。
 */
export function runsDir(
  path = 'runs',
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  const base = env['INIT_CWD'] ?? cwd;
  if (base === '/' || base === '') return join(homedir(), 'Documents', 'git-qa', path);
  return fromInvocationDir(path, env, cwd);
}
