import { describe, expect, it } from 'vitest';

import {
  isPersonalProfilePlace,
  profileKind,
  profileNote,
  shouldRemoveProfile,
} from '../src/profile.js';

/**
 * **ログインが要る画面を検証できるようにする**（外部レビュー meta-taro/git-qa#26）。
 *
 * > こちらのシートは 3 枚あり、そのうち 2 枚は**ログイン後の画面**が対象です。
 * > 今の作りでは、どちらも 1 行目が必ず「ログインする」になります。そうすると
 * > **ID とパスワードをシートか環境変数に書くことになり、これはこちらの規約で禁じています**
 *
 * **既定は変えない。**指定が無ければ、今までどおり毎回まっさらで、終わりに消す。
 * **人が普段使っているブラウザには、変わらず触らない。**
 */
describe('shouldRemoveProfile', () => {
  it('こちらが作った置き場所は、終わりに消す', () => {
    expect(shouldRemoveProfile(undefined)).toBe(true);
  });

  /** **借りたものは返すが、預かったものは消さない。**中にログイン状態が入っている。 */
  it('渡された置き場所は、消さない', () => {
    expect(shouldRemoveProfile('/Users/someone/qa-profile')).toBe(false);
  });
});

/**
 * **証跡に「用意されたプロファイルを使った」ことを残す。**
 *
 * まっさらで走った実行と、**ログイン済みの状態で走った実行**は、
 * 同じ結果でも意味が違う（後者は「その権限の人には見えた」でしかない）。
 * **読んだ人が取り違えないように、事実だけ残す。**
 */
describe('profileNote', () => {
  it('用意された置き場所を使ったことを、証跡へ残す', () => {
    const said = profileNote('/Users/someone/qa-profile');

    expect(said).toContain('用意された');
  });

  /** **中身は残さない。**何のアカウントかは、こちらが書いてよいものではない（§14）。 */
  it('置き場所そのものは残さない', () => {
    expect(profileNote('/Users/someone/qa-profile')).not.toContain('/Users/someone');
  });

  it('まっさらなら、何も言わない', () => {
    expect(profileNote(undefined)).toBeUndefined();
  });
});

/**
 * **普段使いのブラウザの置き場所を指していないか**（外部レビュー meta-taro/git-qa#35）。
 *
 * > `--profile-directory` が付くと、「普段の Chrome をそのまま指す」が最短経路になり、
 * > **検証が人の環境を触る事故が起きやすくなります**
 *
 * **扉はもう開いている** —— `GIT_QA_PROFILE` に `User Data` を渡すと、
 * いまでも `Default`（たいてい**いちばん私物**のプロファイル）が使われる。
 * **足りていないのは口ではなく見張り。**
 *
 * **止めはしない。**専用に用意されたプロファイルは `User Data` の**中**に居るので、
 * 標準の場所を一律で止めると、**いちばんまともな運用が通らなくなる**（#35 の報告者がそれ）。
 */
describe('isPersonalProfilePlace', () => {
  const home = '/Users/someone';

  it('macOS の Chrome の置き場所を見分ける', () => {
    expect(
      isPersonalProfilePlace(`${home}/Library/Application Support/Google/Chrome`, 'darwin', home),
    ).toBe(true);
  });

  it('その中のプロファイルも同じ扱い（親が私物なら中も私物）', () => {
    expect(
      isPersonalProfilePlace(
        `${home}/Library/Application Support/Google/Chrome/Profile 3`,
        'darwin',
        home,
      ),
    ).toBe(true);
  });

  it('Windows の置き場所を見分ける（区切りが \\ でも読む）', () => {
    expect(
      isPersonalProfilePlace(
        'C:\\Users\\someone\\AppData\\Local\\Google\\Chrome\\User Data',
        'win32',
        'C:\\Users\\someone',
      ),
    ).toBe(true);
  });

  it('Edge / Brave / Chromium も見分ける（中身は同じ Chromium）', () => {
    expect(
      isPersonalProfilePlace(
        'C:\\Users\\someone\\AppData\\Local\\Microsoft\\Edge\\User Data',
        'win32',
        'C:\\Users\\someone',
      ),
    ).toBe(true);
    expect(isPersonalProfilePlace(`${home}/.config/chromium`, 'linux', home)).toBe(true);
    expect(
      isPersonalProfilePlace(`${home}/.config/BraveSoftware/Brave-Browser`, 'linux', home),
    ).toBe(true);
  });

  it('検証のために作った置き場所は、普段使いではない', () => {
    expect(isPersonalProfilePlace(`${home}/qa-profile`, 'darwin', home)).toBe(false);
    expect(isPersonalProfilePlace('D:\\qa\\profile', 'win32', 'C:\\Users\\someone')).toBe(false);
  });

  it('渡されていなければ、そもそも私物ではない', () => {
    expect(isPersonalProfilePlace(undefined, 'darwin', home)).toBe(false);
  });
});

describe('profileNote（普段使いの場所のとき）', () => {
  const home = '/Users/someone';

  it('普段使いの場所だと分かるように書く（読んだ人が取り違えないため）', () => {
    const said = profileNote(`${home}/Library/Application Support/Google/Chrome`, 'darwin', home);

    expect(said).toContain('普段使い');
  });

  it('それでも置き場所そのものは残さない', () => {
    const said = profileNote(`${home}/Library/Application Support/Google/Chrome`, 'darwin', home);

    expect(said).not.toContain(home);
  });
});

/** **証跡へ残す言葉。**まっさら・用意されたもの・私物を分ける（meta-taro/git-qa#35）。 */
describe('profileKind', () => {
  const home = '/Users/someone';

  it('渡されなければ、まっさら', () => {
    expect(profileKind(undefined)).toBe('fresh');
  });

  it('用意された置き場所なら provided', () => {
    expect(profileKind(`${home}/qa-profile`, 'darwin', home)).toBe('provided');
  });

  it('普段使いの置き場所なら personal', () => {
    expect(profileKind(`${home}/Library/Application Support/Google/Chrome`, 'darwin', home)).toBe(
      'personal',
    );
  });
});
