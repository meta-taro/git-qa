import { describe, expect, it } from 'vitest';

import { profileNote, shouldRemoveProfile } from '../src/profile.js';

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
