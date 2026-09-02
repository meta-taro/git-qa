import { isAbsolute, resolve } from 'node:path';

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
