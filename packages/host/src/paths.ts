import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { findWorkspace, runsRootIn, sheetPathIn } from '@git-qa/core';

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

export interface RunHome {
  /** 読むシート（打った場所を基準に解決したもの）。 */
  readonly sheetPath: string;
  /** 証跡の置き場。 */
  readonly runsRoot: string;
  /** 証跡に書くシートの場所。 */
  readonly sheetRefPath: string;
}

/**
 * **コマンドから回しても、証跡は試験の家へ出す**（2026-10-23）。
 *
 * 画面から始める道（`app-cli`）は、シートの近くの `git-qa.json` を見て、その `runs/` へ出す。
 * コマンドの道は**打った場所の `runs/`** へ出していて、**シートのフォルダから打ったときしか家に出なかった。**
 * 同じシートで、入口によって証跡が割れる。**同じ決め方を通す。**
 *
 * **印が無ければ、今までどおり**（打った場所の `runs/`・シートは打ったままの形で書く）。
 */
export function runHomeFor(
  given: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  exists: (path: string) => boolean = existsSync,
): RunHome {
  const sheetPath = fromInvocationDir(given, env, cwd);
  const workspace = findWorkspace(sheetPath, exists);
  if (workspace === undefined) {
    return { sheetPath, runsRoot: runsDir('runs', env, cwd), sheetRefPath: given };
  }
  return {
    sheetPath,
    runsRoot: runsRootIn(workspace),
    // **家からの相対。**絶対パスだと、証跡に個人名が混ざる（§25）。
    sheetRefPath: sheetPathIn(workspace, sheetPath),
  };
}
