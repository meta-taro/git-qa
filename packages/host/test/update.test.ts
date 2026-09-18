import { describe, expect, it } from 'vitest';

import { REPO_RELEASES_URL, isNewer, newerRelease } from '../src/update.js';

/**
 * **「入れ直してください」を毎回お願いしていた**（2026-09-18）。
 *
 * 2 日で 10 本出した。**受け取る側は、新しいのが出たことを知る手段を持っていない。**
 * 配布ページを見に行くしかなく、**古い版のまま不具合を踏み続ける。**
 *
 * **勝手に入れ替えない**（product-baseline §6 の精神 —— 人が見ないまま外へ出す／
 * 中へ入れる経路を作らない）。**出ていることを言うだけ。**入れるかは人が決める。
 */
describe('isNewer', () => {
  it('beta の数は、文字ではなく数で比べる（9 と 10 が逆になる）', () => {
    expect(isNewer('v0.2.0-beta.9', 'v0.2.0-beta.10')).toBe(true);
    expect(isNewer('v0.2.0-beta.10', 'v0.2.0-beta.9')).toBe(false);
  });

  it('同じなら新しくない', () => {
    expect(isNewer('v0.2.0-beta.12', 'v0.2.0-beta.12')).toBe(false);
  });

  it('本番は beta より新しい（beta が取れたら、それは前へ進んでいる）', () => {
    expect(isNewer('v0.2.0-beta.12', 'v0.2.0')).toBe(true);
    expect(isNewer('v0.2.0', 'v0.2.0-beta.12')).toBe(false);
  });

  it('数の桁が違っても数で比べる', () => {
    expect(isNewer('v0.2.0', 'v0.10.0')).toBe(true);
    expect(isNewer('v0.10.0', 'v0.2.0')).toBe(false);
  });

  it('v が付いていてもいなくても同じに読む', () => {
    expect(isNewer('0.2.0-beta.9', 'v0.2.0-beta.10')).toBe(true);
  });

  it('読めない名乗りは「新しくない」にする（dev で建てたものを急かさない）', () => {
    expect(isNewer('dev', 'v0.2.0-beta.12')).toBe(false);
    expect(isNewer('0.2.0-dev', 'v0.2.0-beta.12')).toBe(false);
    expect(isNewer('v0.2.0-beta.12', 'なにか')).toBe(false);
  });
});

/**
 * **`releases/latest` は prerelease を返さない**（2026-09-18・実測で 404 だった）。
 *
 * git-qa は `beta` のあいだ全部 prerelease で出している。
 * `latest` を見ていたら、**誰にも通知が届かない。**
 * **一覧を取って、自分より新しいものを探す。**
 */
describe('newerRelease', () => {
  const answer =
    (...tags: string[]): typeof fetch =>
    () =>
      Promise.resolve(
        new Response(JSON.stringify(tags.map((tag) => ({ tag_name: tag, draft: false }))), {
          status: 200,
        }),
      );

  it('新しいのが出ていたら、その版と配布ページを返す', async () => {
    const said = await newerRelease('v0.2.0-beta.9', { fetch: answer('v0.2.0-beta.12') });

    expect(said).toEqual({ version: 'v0.2.0-beta.12', url: REPO_RELEASES_URL });
  });

  it('同じか古ければ、何も返さない', async () => {
    expect(
      await newerRelease('v0.2.0-beta.12', { fetch: answer('v0.2.0-beta.12') }),
    ).toBeUndefined();
  });

  it('prerelease しか無くても見つける（beta のあいだは全部 prerelease で出している）', async () => {
    const said = await newerRelease('v0.2.0-beta.10', {
      fetch: answer('v0.2.0-beta.12', 'v0.2.0-beta.11', 'v0.2.0-beta.10'),
    });

    expect(said?.version).toBe('v0.2.0-beta.12');
  });

  it('いちばん新しいものを返す（並び順を当てにしない）', async () => {
    const said = await newerRelease('v0.2.0-beta.9', {
      fetch: answer('v0.2.0-beta.10', 'v0.2.0-beta.12', 'v0.2.0-beta.11'),
    });

    expect(said?.version).toBe('v0.2.0-beta.12');
  });

  it('下書きは数えない（まだ配っていない）', async () => {
    const draft = (): typeof fetch => () =>
      Promise.resolve(
        new Response(JSON.stringify([{ tag_name: 'v0.2.0-beta.13', draft: true }]), {
          status: 200,
        }),
      );

    expect(await newerRelease('v0.2.0-beta.12', { fetch: draft() })).toBeUndefined();
  });

  it('繋がらなくても、黙って何も返さない（検証は続けられる）', async () => {
    const broken = (() =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND'))) as unknown as typeof fetch;

    expect(await newerRelease('v0.2.0-beta.9', { fetch: broken })).toBeUndefined();
  });

  it('GitHub が断ってきても落ちない', async () => {
    const rate = (() =>
      Promise.resolve(new Response('', { status: 403 }))) as unknown as typeof fetch;

    expect(await newerRelease('v0.2.0-beta.9', { fetch: rate })).toBeUndefined();
  });

  it('手元で建てたものは、そもそも聞きに行かない（外へ出さない）', async () => {
    let asked = false;
    const watch = (() => {
      asked = true;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    expect(await newerRelease('dev', { fetch: watch })).toBeUndefined();
    expect(asked).toBe(false);
  });
});
