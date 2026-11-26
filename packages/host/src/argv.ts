/**
 * **旗を、場所で数える引数に混ぜない**（外部レビュー meta-taro/git-qa#21）。
 *
 * `--no-ui` を足した直後に走らせたら、**それが「2 つ目の引数（URL）」として読まれた。**
 * 単体の検査は全部通っていたので、**1 回走らせるまで分からなかった。**
 *
 * `process.argv` の先頭 2 つ（実行系と入口）は飛ばし、**旗も飛ばして**数える。
 * **値を取る旗（`--viewport 390x844`）は、その値も飛ばす**（C122）。
 */

/** 値を 1 つ取る旗。`--viewport 390x844` / `--viewport=390x844` のどちらでも書ける。 */
const VALUE_FLAGS: ReadonlySet<string> = new Set(['--viewport']);

export function positional(argv: readonly string[], index: number): string | undefined {
  const values: string[] = [];
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg.startsWith('-')) {
      // `--viewport 390x844` の `390x844` は値。**場所で数えない。**
      if (VALUE_FLAGS.has(arg)) i += 1;
      continue;
    }
    values.push(arg);
  }
  return values[index];
}

/**
 * 値を取る旗を読む。`--name value` と `--name=value` の両方。
 *
 * **旗が在るのに値が無い**（最後に置かれた・次も旗）は `present: true, value: undefined` で返し、
 * 呼ぶ側が人の言葉で止める。黙って既定に落とさない（C20）。
 */
export function flagValue(
  argv: readonly string[],
  name: string,
): { present: boolean; value?: string } {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg.startsWith(`${name}=`)) return { present: true, value: arg.slice(name.length + 1) };
    if (arg === name) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('-')) return { present: true };
      return { present: true, value: next };
    }
  }
  return { present: false };
}
