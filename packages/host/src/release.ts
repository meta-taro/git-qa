import type { Runner } from '@git-qa/core';

/** 証跡に残る道具の名前。**配布物の名前と揃える。** */
export const RUNNER_NAME = 'git-qa';

/** **手元で建てたもの。**配ったものと混ぜないために、版ではなくこう名乗る。 */
const NOT_RELEASED = 'dev';

/**
 * **判定を出した道具の名乗り**（2026-09-18）。
 *
 * `beta.3` も `beta.12` も、名乗りは `0.2.0` のままだった。**どれを使っているか、
 * 本人にも分からない。**試験導入先で「beta.8 で直した」が効いていない場面があり、
 * **こちらも相手も、何を触っているのか確かめられなかった。**
 *
 * **インストーラの版番号は触らない**（`0.2.0` のまま）。MSI は `major.minor.patch`
 * しか受け取らないので、そこにタグを入れると **Windows の配布が壊れる。**
 * 建てるときに `GIT_QA_RELEASE` でタグを渡し、**名乗りだけを本物にする。**
 */
export function runnerOf(env: Record<string, string | undefined> = process.env): Runner {
  const said = env['GIT_QA_RELEASE']?.trim();
  return {
    name: RUNNER_NAME,
    version: said === undefined || said === '' ? NOT_RELEASED : said,
  };
}
