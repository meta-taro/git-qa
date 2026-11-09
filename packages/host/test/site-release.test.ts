import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * **配布ページが、転がる開発版 `dev` を「最新」として配っていた**（2026-10-15）。
 *
 * 一覧の先頭（下書きでないもの）を採ると、`develop` に入るたびに建て直される `dev` がいつも先頭に居る。
 * **配るのは名乗りが版の形（`v0.2.0-beta.20`）のものだけ**にする。
 * アプリの更新確認（packages/host/src/update.ts）と同じ線引き。
 *
 * 2026-11-09 に紹介ページを作り直し、版を読む所は `site/assets/site.js` の純粋な関数になった。
 * ここでは本物の関数を読み込んで検める（DOM に触る所は `document` が無ければ動かない作り）。
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface Release {
  readonly tag_name: string;
  readonly draft?: boolean;
  readonly published_at: string;
  readonly assets: readonly { name: string }[];
}

interface Site {
  pickLatest(releases: readonly Release[]): Release | undefined;
  shippable(releases: readonly Release[]): Release[];
  kindOf(name: string): string | undefined;
  platformOf(ua: string, arch: string | null): string | null;
  sortAssets<T extends { name: string }>(assets: readonly T[]): T[];
  cpuNote(name: string, lang: 'ja' | 'en'): string;
  KINDS: readonly { id: string; label: { ja: string; en: string } }[];
}

let site: Site;
beforeAll(async () => {
  const url = pathToFileURL(join(root, 'site/assets/site.js')).href;
  site = (await import(/* @vite-ignore */ url)) as Site;
});

const asset = (name: string): { name: string } => ({ name });
const dev: Release = {
  tag_name: 'dev',
  published_at: '2026-10-13T12:12:45Z',
  assets: [asset('git-qa_0.2.0_x64_en-US.msi'), asset('git-qa_0.2.0_arm64_en-US.msi')],
};
const beta21: Release = {
  tag_name: 'v0.2.0-beta.21',
  published_at: '2026-11-02T12:44:50Z',
  assets: [
    asset('git-qa_0.2.0_aarch64.dmg'),
    asset('git-qa_0.2.0_x64_en-US.msi'),
    asset('git-qa_0.2.0_x64-setup.exe'),
    asset('git-qa_0.2.0_arm64_en-US.msi'),
  ],
};
const beta20: Release = {
  ...beta21,
  tag_name: 'v0.2.0-beta.20',
  published_at: '2026-10-07T05:20:09Z',
};

describe('配布ページの版 — 開発版を配らない', () => {
  it('先頭に dev が居ても、版の形をした最初のものを配る', () => {
    expect(site.pickLatest([dev, beta21, beta20])?.tag_name).toBe('v0.2.0-beta.21');
  });

  it('下書きは配らない', () => {
    const draft = { ...beta21, tag_name: 'v0.2.0-beta.22', draft: true };
    expect(site.pickLatest([draft, beta21])?.tag_name).toBe('v0.2.0-beta.21');
  });

  it('配れる版が 1 つも無ければ undefined（HTML 側が Releases の一覧を指している）', () => {
    expect(site.pickLatest([dev])).toBeUndefined();
    expect(site.pickLatest([])).toBeUndefined();
  });

  it('過去の版の一覧からも dev と下書きを外し、順は保つ', () => {
    const draft = { ...beta21, tag_name: 'v0.2.0-beta.22', draft: true };
    expect(site.shippable([dev, draft, beta21, beta20]).map((r) => r.tag_name)).toEqual([
      'v0.2.0-beta.21',
      'v0.2.0-beta.20',
    ]);
  });

  it('正式な版（v1.0.0）も先出し版（-beta.N）も版の形として通す', () => {
    const v1 = { ...beta21, tag_name: 'v1.0.0' };
    expect(site.pickLatest([v1])?.tag_name).toBe('v1.0.0');
  });
});

describe('配布ページの札 — インストーラーの名前から種類を決める', () => {
  it.each([
    ['git-qa_0.2.0_universal.dmg', 'mac'],
    ['git-qa_0.2.0_aarch64.dmg', 'mac'],
    ['git-qa_0.2.0_x64_en-US.msi', 'win-x64'],
    ['git-qa_0.2.0_x64-setup.exe', 'win-x64'],
    ['git-qa_0.2.0_arm64_en-US.msi', 'win-arm'],
    ['git-qa_0.2.0_arm64-setup.exe', 'win-arm'],
  ])('%s → %s', (name, kind) => {
    expect(site.kindOf(name)).toBe(kind);
  });

  it('x64 と ARM64 を取り違えない（最初の .msi を採ると、どちらかに当たる）', () => {
    expect(site.kindOf('git-qa_0.2.0_arm64_en-US.msi')).not.toBe('win-x64');
  });

  it('知らない名前（sig・zip）は種類なし', () => {
    expect(site.kindOf('git-qa_0.2.0_x64_en-US.msi.sig')).toBeUndefined();
    expect(site.kindOf('git-qa.app.tar.gz')).toBeUndefined();
  });

  it('.msi を .exe より先に並べる（.exe は代わりの入れ方）', () => {
    const sorted = site.sortAssets([
      asset('git-qa_0.2.0_x64-setup.exe'),
      asset('git-qa_0.2.0_x64_en-US.msi'),
    ]);
    expect(sorted.map((a) => a.name)).toEqual([
      'git-qa_0.2.0_x64_en-US.msi',
      'git-qa_0.2.0_x64-setup.exe',
    ]);
  });

  it('universal より前の mac の版には「Apple シリコンだけ」と添える', () => {
    expect(site.cpuNote('git-qa_0.2.0_aarch64.dmg', 'ja')).toBe('Apple シリコンだけ');
    expect(site.cpuNote('git-qa_0.2.0_universal.dmg', 'ja')).toBe('Apple シリコン・Intel');
    expect(site.cpuNote('git-qa_0.2.0_universal.dmg', 'en')).toBe('Apple Silicon · Intel');
    expect(site.cpuNote('git-qa_0.2.0_x64_en-US.msi', 'ja')).toBe('');
  });

  it('札の種類は mac 1 つと Windows 2 つ（mac は universal 1 本なので CPU で分けない）', () => {
    expect(site.KINDS.map((k) => k.id)).toEqual(['mac', 'win-x64', 'win-arm']);
    for (const k of site.KINDS) {
      expect(k.label.ja.length).toBeGreaterThan(0);
      expect(k.label.en.length).toBeGreaterThan(0);
    }
  });
});

describe('配布ページの「この PC」 — 見ている PC を当てる', () => {
  const mac =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
  const win =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
  const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';

  it('Mac は CPU が分かっても分からなくても mac（1 本で両方に入る）', () => {
    expect(site.platformOf(mac, null)).toBe('mac');
    expect(site.platformOf(mac, 'arm')).toBe('mac');
    expect(site.platformOf(mac, 'x86')).toBe('mac');
  });

  it('Windows は CPU が分かれば ARM64、分からなければ x64', () => {
    expect(site.platformOf(win, 'arm')).toBe('win-arm');
    expect(site.platformOf(win, 'x86')).toBe('win-x64');
    expect(site.platformOf(win, null)).toBe('win-x64');
  });

  it('iPhone や Linux には印を付けない', () => {
    expect(site.platformOf(iphone, null)).toBeNull();
    expect(site.platformOf('Mozilla/5.0 (X11; Linux x86_64)', null)).toBeNull();
  });
});
