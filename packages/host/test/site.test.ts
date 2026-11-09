import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **紹介ページ（`site/`）の形を、検査で持つ**（2026-11-09）。
 *
 * 構成と仕組みは tadori の紹介ページの作りを写した。写した以上、**相手の名前が残っていないこと**を
 * 機械で確かめる（題・説明・OGP・構造化データ・llms.txt・事例）。
 * ほかに、人が気をつける方式では必ず漏れるものを並べる：
 * sitemap とページの一致、構造化データが JSON として読めること、FAQ が画面にもあること、
 * 中のリンクが実在すること、**版数を本文に書かないこと**（版はリリースから読む）。
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const site = join(root, 'site');
const BASE = 'https://meta-taro.github.io/git-qa/';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const read = (path: string): string => readFileSync(path, 'utf8');
const files = walk(site);
const pages = files.filter((f) => f.endsWith('.html') && !f.endsWith('404.html'));
const rel = (f: string): string => relative(site, f).split('\\').join('/');

/** ページの中の構造化データ（JSON-LD）を全部、読んで返す。読めなければそこで落ちる。 */
const jsonLd = (html: string): Record<string, unknown>[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1] ?? '{}') as Record<string, unknown>,
  );

/** タグを外して文章だけにする（本文の検査用）。script と style は除く。 */
const textOf = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ');

describe('紹介ページ — 写した相手の名前が残っていない', () => {
  it.each(files.filter((f) => /\.(html|txt|xml|css|js)$/.test(f)).map((f) => [rel(f), f]))(
    '%s に tadori の文字が無い',
    (_name, path) => {
      expect(read(path).toLowerCase()).not.toContain('tadori');
    },
  );
});

describe('紹介ページ — それぞれのページの頭', () => {
  it.each(pages.map((f) => [rel(f), f]))(
    '%s に title・description・canonical がある',
    (name, path) => {
      const html = read(path);
      expect(html).toMatch(/<html lang="(ja|en)">/);
      expect(/<title>[^<]+<\/title>/.exec(html)?.[0], 'title').toBeDefined();
      expect(/name="description"\s+content="[^"]+"/.exec(html), 'description').not.toBeNull();
      const canonical = /rel="canonical"\s+href="([^"]+)"/.exec(html)?.[1];
      expect(canonical, 'canonical').toBeDefined();
      const expected = BASE + name.replace(/index\.html$/, '');
      expect(canonical).toBe(expected);
    },
  );

  it('title と og:title は git-qa を名乗る', () => {
    for (const path of pages) {
      const html = read(path);
      expect(/<title>([^<]+)<\/title>/.exec(html)?.[1], rel(path)).toContain('git-qa');
    }
  });
});

describe('紹介ページ — 構造化データ', () => {
  it.each(pages.map((f) => [rel(f), f]))('%s の JSON-LD は JSON として読める', (_name, path) => {
    for (const said of jsonLd(read(path))) expect(said['@context']).toBe('https://schema.org');
  });

  it('トップの FAQPage の問いは、画面の「よくある質問」と同じ（両言語）', () => {
    for (const page of ['index.html', 'en/index.html']) {
      const html = read(join(site, page));
      const faq = jsonLd(html).find((d) => d['@type'] === 'FAQPage');
      expect(faq, `${page} に FAQPage が無い`).toBeDefined();
      const questions = (
        faq?.['mainEntity'] as { name: string; acceptedAnswer: { text: string } }[]
      ).map((q) => q.name);
      const shown = [...html.matchAll(/<summary>([^<]+)<\/summary>/g)].map((m) => m[1]);
      expect(shown, page).toEqual(questions);
      expect(questions.length, page).toBeGreaterThanOrEqual(5);
    }
  });

  it('事例のページは TechArticle とパンくずを持ち、アプリの @id を指す', () => {
    const cases = pages.filter(
      (f) => rel(f).startsWith('cases/') && !rel(f).endsWith('index.html'),
    );
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const path of cases) {
      const graph = jsonLd(read(path))[0]?.['@graph'] as Record<string, unknown>[];
      const types = graph.map((g) => g['@type']);
      expect(types, rel(path)).toContain('TechArticle');
      expect(types, rel(path)).toContain('BreadcrumbList');
      const article = graph.find((g) => g['@type'] === 'TechArticle');
      expect((article?.['about'] as Record<string, unknown>)['@id']).toBe(`${BASE}#app`);
    }
  });

  it('事例の一覧（ItemList）は、在る事例のページを全部指す', () => {
    const list = jsonLd(read(join(site, 'cases/index.html')))[0];
    const urls = (list?.['itemListElement'] as { url: string }[]).map((i) => i.url).sort();
    const actual = pages
      .filter((f) => rel(f).startsWith('cases/') && !rel(f).endsWith('index.html'))
      .map((f) => BASE + rel(f))
      .sort();
    expect(urls).toEqual(actual);
  });
});

describe('紹介ページ — sitemap・robots・llms.txt', () => {
  const sitemap = read(join(site, 'sitemap.xml'));
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();

  it('sitemap はページを全部、過不足なく持つ（404 は除く）', () => {
    const expected = pages.map((f) => BASE + rel(f).replace(/index\.html$/, '')).sort();
    expect(locs).toEqual(expected);
  });

  it('robots.txt はすべてを許し、sitemap を指す', () => {
    const robots = read(join(site, 'robots.txt'));
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toContain(`Sitemap: ${BASE}sitemap.xml`);
  });

  it('llms.txt が指すこのサイトのページは、どれも在る', () => {
    const links = [
      ...read(join(site, 'llms.txt')).matchAll(
        /\]\((https:\/\/meta-taro\.github\.io\/git-qa\/[^)]*)\)/g,
      ),
    ].map((m) => m[1] ?? '');
    expect(links.length).toBeGreaterThan(5);
    for (const url of links) {
      const path = url.slice(BASE.length) || 'index.html';
      const target = path.endsWith('/') ? `${path}index.html` : path;
      expect(existsSync(join(site, target)), url).toBe(true);
    }
  });
});

describe('紹介ページ — 中のリンクと絵', () => {
  it.each(pages.map((f) => [rel(f), f]))('%s の相対リンクと絵は、どれも在る', (_name, path) => {
    const html = read(path);
    const refs = [...html.matchAll(/(?:href|src)="([^"#:]+)(?:#[^"]*)?"/g)].map((m) => m[1] ?? '');
    for (const ref of refs) {
      if (ref === '' || ref.startsWith('//')) continue;
      const target = ref.startsWith('/git-qa/')
        ? join(site, ref.slice('/git-qa/'.length))
        : resolve(dirname(path), ref);
      const file =
        target.endsWith('/') || statSync(target, { throwIfNoEntry: false })?.isDirectory()
          ? join(target, 'index.html')
          : target;
      expect(existsSync(file), `${rel(path)} → ${ref}`).toBe(true);
    }
  });

  it('404 のリンクはサイトの根（/git-qa/）から辿る（どの深さで出ても効くように）', () => {
    const html = read(join(site, '404.html'));
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      expect(m[1], m[1]).toMatch(/^\/git-qa\//);
    }
  });

  it('絵には width と height がある（読み込み中に段が動かないように）', () => {
    for (const path of pages) {
      for (const m of read(path).matchAll(/<img [^>]*src="[^"]*img\/[^"]*"[^>]*>/g)) {
        expect(m[0], `${rel(path)}: ${m[0].slice(0, 60)}`).toMatch(/width="\d+"/);
        expect(m[0], `${rel(path)}: ${m[0].slice(0, 60)}`).toMatch(/height="\d+"/);
      }
    }
  });
});

describe('紹介ページ — 版数は本文に書かない（リリースから読む）', () => {
  it.each(pages.map((f) => [rel(f), f]))('%s の本文に版の形の数字が無い', (_name, path) => {
    const text = textOf(read(path));
    // 127.0.0.1 のような 4 つ組は版ではない。前後に数字や点が続く所は外す。
    const found = text.match(/(?<![\d.])v?\d+\.\d+\.\d+(?:-beta\.\d+)?(?![\d.])/g) ?? [];
    expect(found).toEqual([]);
  });

  it('ダウンロードのページと過去の版は、JS が版を入れる印を持つ', () => {
    expect(read(join(site, 'download.html'))).toContain('data-downloads');
    expect(read(join(site, 'download.html'))).toContain('data-release-status');
    expect(read(join(site, 'releases.html'))).toContain('data-archive');
    expect(read(join(site, 'en/index.html'))).toContain('data-downloads');
  });

  it('ダウンロードの札は、JS の種類（mac・win-x64・win-arm）と同じ名前', () => {
    for (const page of ['download.html', 'en/index.html']) {
      const kinds = [...read(join(site, page)).matchAll(/data-kind="([^"]+)"/g)].map((m) => m[1]);
      expect(kinds, page).toEqual(['mac', 'win-x64', 'win-arm']);
    }
  });
});
