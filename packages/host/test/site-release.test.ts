import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

/**
 * **配布ページが、転がる開発版 `dev` を「最新」として配っていた**（2026-10-15）。
 *
 * `site/release.js` は Releases の一覧の先頭（下書きでないもの）を採っていた。
 * `dev` は `develop` に入るたびに建て直されるので、いつも先頭に居る。
 * その結果、Windows のボタンは開発版の .msi を指し、
 * `dev` に .dmg が無いので macOS のボタンは Releases の一覧へ落ちていた。
 *
 * **配るのは名乗りが版の形（`v0.2.0-beta.20`）のものだけ**にする。
 * アプリの更新確認（packages/host/src/update.ts）と同じ線引き。
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = readFileSync(join(root, 'site/release.js'), 'utf8');

interface Release {
  readonly tag_name: string;
  readonly draft?: boolean;
  readonly published_at: string;
  readonly assets: readonly { name: string; size: number; browser_download_url: string }[];
}

const asset = (name: string): Release['assets'][number] => ({
  name,
  size: 3 * 1024 * 1024,
  browser_download_url: `https://example.test/${name}`,
});

/** 本物の release.js を、偽の document と fetch の上で走らせ、書かれた文字とリンクを返す。 */
async function run(
  releases: readonly Release[],
  lang = 'ja',
): Promise<Record<string, { text: string; href: string }>> {
  const nodes: Record<string, { textContent: string; href: string }> = {};
  const node = (id: string): { textContent: string; href: string } =>
    (nodes[id] ??= { textContent: '', href: '' });
  const document = { documentElement: { lang }, getElementById: node };
  const fetch = (): Promise<unknown> =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(releases) });

  runInNewContext(script, { document, fetch, Date, String, Array, Error });
  // スクリプトは非同期の即時関数。中の await が全部片付くまで、1 巡だけ待つ。
  await new Promise((resolve) => setTimeout(resolve, 0));

  return Object.fromEntries(
    Object.entries(nodes).map(([id, n]) => [id, { text: n.textContent, href: n.href }]),
  );
}

const dev: Release = {
  tag_name: 'dev',
  published_at: '2026-10-13T12:12:45Z',
  assets: [asset('git-qa_0.2.0_x64_en-US.msi'), asset('git-qa_0.2.0_arm64_en-US.msi')],
};
const beta20: Release = {
  tag_name: 'v0.2.0-beta.20',
  published_at: '2026-10-07T05:20:09Z',
  assets: [
    asset('git-qa_0.2.0_aarch64.dmg'),
    asset('git-qa_0.2.0_x64_en-US.msi'),
    asset('git-qa_0.2.0_arm64_en-US.msi'),
  ],
};

describe('配布ページの版 — 開発版を配らない', () => {
  it('先頭に dev が居ても、版の形をした最初のものを配る', async () => {
    const shown = await run([dev, beta20]);
    expect(shown['ver']?.text).toBe('最新 v0.2.0-beta.20');
    expect(shown['dl-mac']?.href).toBe('https://example.test/git-qa_0.2.0_aarch64.dmg');
    expect(shown['dl-win']?.href).toBe('https://example.test/git-qa_0.2.0_x64_en-US.msi');
  });

  it('英語の頁でも同じ版を出す', async () => {
    const shown = await run([dev, beta20], 'en');
    expect(shown['ver']?.text).toBe('Latest v0.2.0-beta.20');
  });

  it('下書きは配らない', async () => {
    const shown = await run([{ ...beta20, tag_name: 'v0.2.0-beta.21', draft: true }, beta20]);
    expect(shown['ver']?.text).toBe('最新 v0.2.0-beta.20');
  });

  it('配れる版が 1 つも無ければ、黙らずに Releases へ案内する', async () => {
    const shown = await run([dev]);
    expect(shown['ver']?.text).toBe('Releases を見る');
    // リンクには触らない —— HTML 側で既に Releases の一覧を指している。
    expect(shown['dl-win']).toBeUndefined();
  });
});
