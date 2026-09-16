/**
 * **旗を、場所で数える引数に混ぜない**（外部レビュー meta-taro/git-qa#21）。
 *
 * `--no-ui` を足した直後に走らせたら、**それが「2 つ目の引数（URL）」として読まれた。**
 * 単体の検査は全部通っていたので、**1 回走らせるまで分からなかった。**
 *
 * `process.argv` の先頭 2 つ（実行系と入口）は飛ばし、**旗も飛ばして**数える。
 */
export function positional(argv: readonly string[], index: number): string | undefined {
  const values = argv.slice(2).filter((arg) => !arg.startsWith('-'));
  return values[index];
}
