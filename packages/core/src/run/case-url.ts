import type { TargetSession } from '../adapter/types.js';

/**
 * **判定した時点の URL を証跡に残す**（meta-taro/git-qa#40）。
 *
 * ウェブでは「同じ見た目の別ページ」が普通に起きる（認証の戻り・リダイレクト・クエリ付きの再読み込み）。
 * **画面の絵だけでは、その区別が付かない。**`target.destination` は最初の 1 個しか語らない。
 *
 * **クエリの値は伏せる。**証跡は commit されるので、値を残すとメールやトークンがリポに入る。
 * 名前は残す —— どの名前が付いていたかが分かれば、流れを復元するには足りる（報告者の判断）。
 */

const MASK = '***';

/** `?email=a@b.c&next=/home` → `?email=***&next=***`。名前だけ残す。断片（`#`）は触らない。 */
export function maskQueryValues(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // 読めないものを「伏せた」ことにしない。そのまま返す。
    return url;
  }
  if (parsed.search === '') return url;
  const names = [...new Set([...parsed.searchParams.keys()])];
  parsed.search = names.map((name) => `${name}=${MASK}`).join('&');
  return parsed.toString();
}

/**
 * いま居る URL を聞いて、伏せて返す。**言えない相手（端末・デスクトップ）は `undefined`。**
 * 聞く途中で投げられても、判定は止めない（証跡のための測りで、検証そのものではない）。
 */
export async function captureCaseUrl(session: TargetSession): Promise<string | undefined> {
  try {
    const said = await session.url?.();
    return said === undefined || said === '' ? undefined : maskQueryValues(said);
  } catch {
    return undefined;
  }
}
