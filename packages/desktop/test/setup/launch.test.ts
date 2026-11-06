import { describe, expect, it } from 'vitest';

import { launchParams, parseLaunchUrl, whyCannotLaunch } from '../../src/setup/launch.js';

/**
 * **外から「このシートのこのケースを確かめてくれ」と呼ばれる口**（C112）。
 *
 *   git-qa://run?sheet=<検証シートの絶対パス>&case=<No.>&target=<見る相手>
 *
 * 漏れを並べる側の道具（tadori）が、画面のアイコンから git-qa を呼ぶ。
 * **受け取った文字列をそのまま信用しない。**シートは絶対パスの TSV、No. は 1 以上の整数、
 * 相手は URL・`app:名前`・端末の serial のどれかの形でなければ受け取らない。
 */
describe('parseLaunchUrl', () => {
  it('シート・ケース・相手を読む', () => {
    const parsed = parseLaunchUrl(
      'git-qa://run?sheet=%2FUsers%2Fme%2Fdocs%2F001.tsv&case=7&target=https%3A%2F%2Fexample.test%2F',
    );
    expect(parsed).toEqual({
      ok: true,
      request: { sheetPath: '/Users/me/docs/001.tsv', caseNo: 7, target: 'https://example.test/' },
    });
  });

  it('Windows の絶対パスも読む', () => {
    const parsed = parseLaunchUrl(
      'git-qa://run?sheet=C%3A%5Cdocs%5C001.tsv&target=app%3A%E9%9B%BB%E5%8D%93',
    );
    expect(parsed).toEqual({
      ok: true,
      request: { sheetPath: 'C:\\docs\\001.tsv', target: 'app:電卓' },
    });
  });

  it('ケースと相手は省ける（シートだけ渡して、画面で選ぶ）', () => {
    expect(parseLaunchUrl('git-qa://run?sheet=%2Fdocs%2F001.tsv')).toEqual({
      ok: true,
      request: { sheetPath: '/docs/001.tsv' },
    });
  });

  it('端末の serial も相手になる', () => {
    const parsed = parseLaunchUrl('git-qa://run?sheet=%2Fdocs%2F001.tsv&target=emulator-5554');
    expect(parsed).toMatchObject({ ok: true, request: { target: 'emulator-5554' } });
  });

  it.each([
    ['別のスキーム', 'https://run?sheet=%2Fdocs%2F001.tsv'],
    ['run 以外', 'git-qa://open?sheet=%2Fdocs%2F001.tsv'],
    ['シートが無い', 'git-qa://run?case=1'],
    ['シートが相対', 'git-qa://run?sheet=docs%2F001.tsv'],
    ['シートが ../ 入り', 'git-qa://run?sheet=%2Fdocs%2F..%2F001.tsv'],
    ['シートが TSV でない', 'git-qa://run?sheet=%2Fdocs%2F001.md'],
    ['No. が 0', 'git-qa://run?sheet=%2Fdocs%2F001.tsv&case=0'],
    ['No. が数でない', 'git-qa://run?sheet=%2Fdocs%2F001.tsv&case=seven'],
    ['相手が知らない形', 'git-qa://run?sheet=%2Fdocs%2F001.tsv&target=ftp%3A%2F%2Fx'],
    ['相手の app: が空', 'git-qa://run?sheet=%2Fdocs%2F001.tsv&target=app%3A'],
    ['URL ですらない', 'こんにちは'],
  ])('%s は受け取らず、理由を言う', (_label, raw) => {
    const parsed = parseLaunchUrl(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason.length).toBeGreaterThan(0);
  });
});

describe('launchParams', () => {
  const remembered = { operator: 'octocat', browser: 'chrome', browserPath: '' };

  it('覚えているハンドルとブラウザを添えて、始める形にする', () => {
    expect(
      launchParams(
        { sheetPath: '/docs/001.tsv', caseNo: 7, target: 'https://example.test/' },
        remembered,
      ),
    ).toEqual({
      serial: 'https://example.test/',
      sheetPath: '/docs/001.tsv',
      operator: 'octocat',
      browser: 'chrome',
      caseNo: 7,
    });
  });

  it('「その他」のブラウザなら場所も添える', () => {
    expect(
      launchParams(
        { sheetPath: '/docs/001.tsv', target: 'https://example.test/' },
        { operator: 'octocat', browser: 'other', browserPath: '/Applications/X.app' },
      ),
    ).toMatchObject({ browser: 'other', browserPath: '/Applications/X.app' });
  });

  /** 相手が無ければ自動では始めない。**画面で選ぶ所で止まる。** */
  it('相手が無ければ undefined', () => {
    expect(launchParams({ sheetPath: '/docs/001.tsv' }, remembered)).toBeUndefined();
  });

  /** **誰が置いたか分からない証跡を作らない。**ハンドルが無ければ始めない。 */
  it('ハンドルが無ければ undefined', () => {
    expect(
      launchParams(
        { sheetPath: '/docs/001.tsv', target: 'https://example.test/' },
        { ...remembered, operator: '' },
      ),
    ).toBeUndefined();
  });
});

describe('whyCannotLaunch', () => {
  it('相手が無いときは、その欄を指す', () => {
    expect(whyCannotLaunch({ sheetPath: '/docs/001.tsv' }, 'octocat')).toBe('setup.blocked.device');
  });

  it('ハンドルが無いときは、その欄を指す', () => {
    expect(whyCannotLaunch({ sheetPath: '/docs/001.tsv', target: 'app:X' }, '')).toBe(
      'setup.blocked.operator.empty',
    );
  });

  it('規則に合わないハンドルも止める', () => {
    expect(whyCannotLaunch({ sheetPath: '/docs/001.tsv', target: 'app:X' }, 'a b')).toBe(
      'setup.blocked.operator.bad',
    );
  });

  it('揃っていれば undefined', () => {
    expect(
      whyCannotLaunch({ sheetPath: '/docs/001.tsv', target: 'app:X' }, 'octocat'),
    ).toBeUndefined();
  });
});
