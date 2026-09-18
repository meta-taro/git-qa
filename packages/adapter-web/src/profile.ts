import type { BrowserProfileKind } from '@git-qa/core';

/**
 * **ログインが要る画面を検証できるようにする**（外部レビュー meta-taro/git-qa#26）。
 *
 * ウェブの検証は毎回まっさらなプロファイルで起こし、終わりに消す。
 * **人が普段使っているブラウザを乗っ取らないため**で、そこは変えない。
 *
 * 変えるのは 1 つだけ —— **置き場所を渡せるようにする。**
 * 渡されたときは**消さない**（借りたものは返すが、**預かったものは消さない**）。
 *
 * **中に入れるものは人の領分。**git-qa は秘密情報を作らない・置かない・貼らない
 * （product-baseline §14）。**最初のログインは人が手で行う。**
 */

/** こちらが作った置き場所だけ、終わりに消す。 */
export function shouldRemoveProfile(given: string | undefined): boolean {
  return given === undefined;
}

/**
 * **普段使いのブラウザの置き場所**（外部レビュー meta-taro/git-qa#35）。
 *
 * OS ごとに決まっている所だけを並べてある。**中のプロファイルも同じ扱い** ——
 * 親が私物なら、その中も私物。
 *
 * **Chromium 系はどれも同じ危うさ**なので、Chrome だけでなく Edge / Brave /
 * Vivaldi / Opera / Chromium も見る。
 */
const PERSONAL_PLACES: Readonly<Record<string, readonly string[]>> = {
  darwin: [
    'Library/Application Support/Google/Chrome',
    'Library/Application Support/Chromium',
    'Library/Application Support/Microsoft Edge',
    'Library/Application Support/BraveSoftware/Brave-Browser',
    'Library/Application Support/Vivaldi',
    'Library/Application Support/com.operasoftware.Opera',
  ],
  win32: [
    'AppData/Local/Google/Chrome/User Data',
    'AppData/Local/Chromium/User Data',
    'AppData/Local/Microsoft/Edge/User Data',
    'AppData/Local/BraveSoftware/Brave-Browser/User Data',
    'AppData/Local/Vivaldi/User Data',
    'AppData/Roaming/Opera Software',
  ],
  linux: [
    '.config/google-chrome',
    '.config/chromium',
    '.config/microsoft-edge',
    '.config/BraveSoftware/Brave-Browser',
    '.config/vivaldi',
    '.config/opera',
  ],
};

/** 区切りを揃え、末尾の `/` を落とす。**`\\` と `/` の違いで見張りを抜けさせない。** */
const flatten = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * **人が普段使っているブラウザの置き場所を指していないか**（meta-taro/git-qa#35）。
 *
 * **止めるためではなく、言うため。**専用に用意されたプロファイルは
 * `User Data` の**中**に居ることがあるので、**標準の場所を一律で止めると、
 * いちばんまともな運用が通らなくなる**（#35 の報告者がそれ）。
 */
export function isPersonalProfilePlace(
  given: string | undefined,
  platform: string = process.platform,
  home: string = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
): boolean {
  if (given === undefined) return false;

  const here = flatten(given);
  const base = flatten(home);
  if (base === '') return false;
  // **その人の家の外なら、私物の置き場所ではない**（検証用に作った D:\qa など）。
  if (!here.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return false;

  const places = PERSONAL_PLACES[platform] ?? PERSONAL_PLACES['linux'] ?? [];
  const rest = here.slice(base.length + 1).toLowerCase();
  return places.some((place) => {
    const want = place.toLowerCase();
    return rest === want || rest.startsWith(`${want}/`);
  });
}

/**
 * 証跡へ残す 1 行。**「用意されたものを使った」という事実だけ。**
 *
 * まっさらで走った実行と、**ログイン済みで走った実行**は、同じ結果でも意味が違う
 * （後者は「その権限の人には見えた」でしかない）。**読んだ人が取り違えないため。**
 *
 * **普段使いの置き場所なら、そうと分かるように書く**（meta-taro/git-qa#35）。
 * 用意されたプロファイルと、**その人の私物**では、読む人にとっての意味が違う。
 *
 * **置き場所も、何のアカウントかも残さない。**
 */
export function profileNote(
  given: string | undefined,
  platform?: string,
  home?: string,
): string | undefined {
  if (given === undefined) return undefined;
  if (isPersonalProfilePlace(given, platform, home)) {
    return '普段使いのブラウザの置き場所にあるプロファイルを使った（その人の私物を見ている）';
  }
  return '用意されたブラウザのプロファイルを使った（ログイン済みの状態で見ている可能性がある）';
}

/**
 * **証跡へ残す言葉**（外部レビュー meta-taro/git-qa#35）。
 *
 * まっさら・用意されたもの・**その人の私物**は、同じ結果でも意味が違う。
 * 「その権限の人には見えた」でしかないのか、**私物の環境を触ったのか**が
 * 読む人に分からないと、証跡として弱い。
 */
export function profileKind(
  given: string | undefined,
  platform?: string,
  home?: string,
): BrowserProfileKind {
  if (given === undefined) return 'fresh';
  return isPersonalProfilePlace(given, platform, home) ? 'personal' : 'provided';
}
