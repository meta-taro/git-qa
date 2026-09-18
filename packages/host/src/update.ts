/**
 * **新しい版が出ていることを、使っている人へ言う**（2026-09-18）。
 *
 * 2 日で 10 本出した。**受け取る側は、新しいのが出たことを知る手段を持っていない。**
 * 配布ページを見に行くしかなく、**古い版のまま不具合を踏み続ける。**
 *
 * **勝手に入れ替えない**（`product-baseline.md` §6 の精神 —— 人が見ないまま外へ出す・
 * 中へ入れる経路を作らない）。**出ていることを言うだけ。**入れるかは人が決める。
 *
 * **依存は足していない。**Node の `fetch` で足りる。
 */

/** 配布ページ。**ここへ人を送る。**入れるのは人の操作。 */
export const REPO_RELEASES_URL = 'https://meta-taro.github.io/git-qa/';

/**
 * **`releases/latest` は使わない**（2026-09-18・実測で 404 だった）。
 *
 * **prerelease は `latest` に出てこない。**git-qa は `beta` のあいだ全部
 * prerelease で出しているので、`latest` を見ていたら**誰にも通知が届かない。**
 * **一覧を取って、自分より新しいものを探す。**
 */
const RELEASES_API = 'https://api.github.com/repos/meta-taro/git-qa/releases?per_page=10';

/** 名乗りを数の並びに解く。**読めなければ `undefined`**（`dev` はここに落ちる）。 */
interface Parsed {
  readonly numbers: readonly number[];
  /** `beta.12` の 12。**本番（beta が付かない）は `undefined`。** */
  readonly pre?: number;
}

const parse = (said: string): Parsed | undefined => {
  const matched = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(said.trim());
  if (matched === null) return undefined;

  const numbers = [matched[1], matched[2], matched[3]].map((part) => Number(part));
  const pre = matched[4];
  return pre === undefined ? { numbers } : { numbers, pre: Number(pre) };
};

/**
 * **`beta.9` と `beta.10` を文字で比べると逆になる。**数で比べる。
 *
 * 読めない名乗り（`dev` で建てたもの）は**新しくない**にする。
 * **手元で建てている人を急かさない。**
 */
export function isNewer(current: string, latest: string): boolean {
  const here = parse(current);
  const there = parse(latest);
  if (here === undefined || there === undefined) return false;

  for (let i = 0; i < here.numbers.length; i += 1) {
    const a = here.numbers[i] ?? 0;
    const b = there.numbers[i] ?? 0;
    if (a !== b) return b > a;
  }

  // ここまで同じなら、beta が取れているほうが新しい。
  if (here.pre === undefined) return false;
  if (there.pre === undefined) return true;
  return there.pre > here.pre;
}

export interface NewerRelease {
  readonly version: string;
  readonly url: string;
}

export interface NewerReleaseOptions {
  readonly fetch?: typeof fetch;
}

/**
 * **新しい版が出ているか聞く。**出ていなければ・聞けなければ `undefined`。
 *
 * **落とさない。**繋がらない機械でも検証は続けられなければならない
 * （`product-baseline.md` §4「外部サービスに繋がるテストは、繋がらない環境でも走る形にする」）。
 */
export async function newerRelease(
  current: string,
  options: NewerReleaseOptions = {},
): Promise<NewerRelease | undefined> {
  // **手元で建てたものは、そもそも聞きに行かない。**外へ出す必要が無い。
  if (parse(current) === undefined) return undefined;

  const ask = options.fetch ?? fetch;
  try {
    const answer = await ask(RELEASES_API, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!answer.ok) return undefined;

    const body: unknown = await answer.json();
    if (!Array.isArray(body)) return undefined;

    // **並び順は当てにしない。**いちばん新しいものを自分で選ぶ。
    // **下書きは数えない**（まだ配っていない）。
    let newest: string | undefined;
    for (const item of body as unknown[]) {
      if (typeof item !== 'object' || item === null) continue;
      const said = item as { tag_name?: unknown; draft?: unknown };
      if (said.draft === true || typeof said.tag_name !== 'string') continue;
      if (!isNewer(current, said.tag_name)) continue;
      if (newest === undefined || isNewer(newest, said.tag_name)) newest = said.tag_name;
    }

    return newest === undefined ? undefined : { version: newest, url: REPO_RELEASES_URL };
  } catch {
    // 繋がらない・答えが読めない。**黙って何も返さない**（検証は続けられる）。
    return undefined;
  }
}
