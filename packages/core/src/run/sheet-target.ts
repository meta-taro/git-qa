/**
 * **「何を検証したか」と「何処を見るか」を分ける**（外部レビュー meta-taro/git-qa#22）。
 *
 * > `# 対象:` には**どのリポジトリのどのブランチを検証したか**を書く規約になっています。
 * > …URL に書き換えれば通りますが、そうすると今度は
 * > **どのブランチを検証したシートなのかがシートから消えます。**
 *
 * 引数で URL を渡す回避もあるが、それは **C40 が守ろうとしているものを外す** ——
 * シートの外から行き先が来ると、**証跡を読んだ人が「何処を見たのか」をシートから辿れない。**
 *
 * **見出しを 1 行増やすだけにする。**`行き先` が在ればそれを見に行き、
 * 無ければ今までどおり `対象` を見に行く。**既存のシートは 1 文字も変えずに動く。**
 */

/** 何を検証したか（シートが宣言する。証跡にそのまま残す）。 */
export const SUBJECT_KEY = '対象';

/** 何処を見るか。**無ければ `対象` を見に行く。** */
export const DESTINATION_KEY = '行き先';

const said = (meta: Record<string, string>, key: string): string | undefined => {
  const value = meta[key];
  // 空白だけの行は「書いていない」と同じ。**空欄で行き先を決めない。**
  return value === undefined || value.trim() === '' ? undefined : value;
};

export function sheetDestination(meta: Record<string, string>): string | undefined {
  return said(meta, DESTINATION_KEY) ?? said(meta, SUBJECT_KEY);
}

export function sheetSubject(meta: Record<string, string>): string | undefined {
  return said(meta, SUBJECT_KEY);
}

/**
 * **行き先が 2 つ在るシートは、走らせない**（外部レビュー meta-taro/git-qa#22）。
 *
 * 様式は後勝ちなので、**黙って動いてしまう。**そうすると
 * **シートには 2 つ、証跡には 1 つ**が残り、読んだ人が突き合わせられない。
 * C40（宣言した所から出ない）が、宣言が 2 つある時点で成り立たない。
 *
 * **どう直すかまで言う。**「駄目です」だけだと、人はシートを眺めることになる。
 */
export function duplicateTargetMessage(duplicateMeta: readonly string[]): string | undefined {
  const hit = duplicateMeta.filter((key) => key === SUBJECT_KEY || key === DESTINATION_KEY);
  if (hit.length === 0) return undefined;

  return (
    `シートの見出し「${hit.join('」「')}」が 2 行以上ある。` +
    '**どちらを見に行ったのかが証跡に残らない**ので走らせない。1 行だけにする'
  );
}
