/* global document, fetch, navigator -- 紹介ページの中で、ブラウザが読む */
// **版と落とす先を、GitHub の Releases から読む。**ここに版を書かない。
// 書き換え忘れで古い版を配らないため（タグを打つたびにページを直す作業を増やさない）。
// 読めないときは Releases のページへ落とす（リンクは HTML 側で既にそこを指している）。
// GitHub から読んだ文字は、そのまま HTML に入れない（textContent で入れる）。
// 見ている PC に合う札へ「この PC」の印を付け、過去の版の一覧も同じ読み方で作る。
// 仕組みは、同じ系列の製品の紹介ページと同じ作りにした（2026-11-09）。

export const REPO = 'meta-taro/git-qa';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=50`;

/**
 * 配るのは名乗りが版の形（v0.2.0-beta.20）のものだけ。
 * **転がる開発版 `dev` は配らない**（develop に入るたびに建て直され、一覧の先頭にいつも居る）。
 * アプリの更新確認（packages/host/src/update.ts）と同じ線引き。
 */
export const VERSION_TAG = /^v?\d+\.\d+\.\d+(?:-beta\.\d+)?$/;

/** 版の一覧から、配ってよい最新の 1 つ（下書きと開発版を飛ばす）。無ければ undefined。 */
export const pickLatest = (releases) =>
  (Array.isArray(releases) ? releases : []).find(
    (r) => !r.draft && VERSION_TAG.test(String(r.tag_name)),
  );

/** 版の一覧から、配ってよいものだけを新しい順に。 */
export const shippable = (releases) =>
  (Array.isArray(releases) ? releases : []).filter(
    (r) => !r.draft && VERSION_TAG.test(String(r.tag_name)),
  );

/**
 * インストーラーの種類。名前は Tauri が付ける形
 * （git-qa_0.2.0_universal.dmg・git-qa_0.2.0_x64_en-US.msi・git-qa_0.2.0_arm64-setup.exe）。
 * mac は universal 1 本なので、CPU で分けない。universal より前の版の .dmg（aarch64）も mac の札に入る。
 */
export const KINDS = [
  {
    id: 'mac',
    label: { ja: 'macOS（Apple シリコン・Intel）', en: 'macOS (Apple Silicon · Intel)' },
    test: (n) => /\.dmg$/i.test(n),
  },
  {
    id: 'win-x64',
    label: { ja: 'Windows（x64・Intel / AMD）', en: 'Windows (x64 · Intel / AMD)' },
    test: (n) => /x64(-setup\.exe|_[a-z-]+\.msi)$/i.test(n),
  },
  {
    id: 'win-arm',
    label: { ja: 'Windows（ARM64）', en: 'Windows (ARM64)' },
    test: (n) => /arm64(-setup\.exe|_[a-z-]+\.msi)$/i.test(n),
  },
];

/** 名前から種類の id を返す。どれでもなければ undefined。 */
export const kindOf = (name) => KINDS.find((k) => k.test(name))?.id;

/**
 * 見ている PC：OS と、分かれば CPU（Chromium 系だけが CPU を教えてくれる）。
 * Mac は universal 1 本なので CPU を見ない。Windows で分からなければ、数の多い x64 を示す。
 */
export const platformOf = (ua, arch) => {
  const os =
    /Mac/i.test(ua) && !/iPhone|iPad/i.test(ua) ? 'mac' : /Windows/i.test(ua) ? 'win' : null;
  if (!os) return null;
  if (os === 'mac') return 'mac';
  return arch === 'arm' ? 'win-arm' : 'win-x64';
};

/** ひとつの版の中で、種類ごとに並べる順（.msi を先に。.exe は代わりの入れ方）。 */
export const sortAssets = (assets) =>
  [...assets].sort((a, b) => Number(/\.exe$/i.test(a.name)) - Number(/\.exe$/i.test(b.name)));

/** 名前に CPU の印が出ているとき、その注記（universal より前の mac の版を見分ける）。 */
export const cpuNote = (name, lang) => {
  if (/aarch64\.dmg$/i.test(name))
    return lang === 'en' ? 'Apple Silicon only' : 'Apple シリコンだけ';
  if (/universal\.dmg$/i.test(name))
    return lang === 'en' ? 'Apple Silicon · Intel' : 'Apple シリコン・Intel';
  return '';
};

const STRINGS = {
  ja: {
    format: (n) =>
      /\.dmg$/i.test(n)
        ? 'ディスクイメージ（.dmg）'
        : /\.msi$/i.test(n)
          ? 'インストーラー（.msi）'
          : 'セットアップ（.exe）',
    mine: 'この PC',
    reading: 'GitHub から版の一覧を読んでいます…',
    unreadable: (status) =>
      `GitHub から読めませんでした（${status}）。GitHub のリリースのページから選んでください。`,
    none: 'まだ配れる版がありません。GitHub のリリースのページで確かめてください。',
    latest: (name, date) => `最新の版：${name}（${date}）`,
    missing: 'この版には入っていません',
    noAssets: 'インストーラーはありません',
    notes: 'この版の説明（GitHub）',
    pre: '先出し',
    date: (iso) =>
      new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }),
  },
  en: {
    format: (n) =>
      /\.dmg$/i.test(n)
        ? 'Disk image (.dmg)'
        : /\.msi$/i.test(n)
          ? 'Installer (.msi)'
          : 'Setup (.exe)',
    mine: 'This PC',
    reading: 'Reading releases from GitHub…',
    unreadable: (status) => `Could not read GitHub (${status}). Pick from the Releases page.`,
    none: 'No shippable release yet. Check the Releases page.',
    latest: (name, date) => `Latest: ${name} (${date})`,
    missing: 'Not in this release',
    noAssets: 'No installers',
    notes: 'Release notes (GitHub)',
    pre: 'pre-release',
    date: (iso) =>
      new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
  },
};

const sizeOf = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function detectPlatform() {
  let arch = null;
  try {
    const data = await navigator.userAgentData?.getHighEntropyValues(['architecture']);
    if (data?.architecture) arch = data.architecture === 'arm' ? 'arm' : 'x86';
  } catch {
    // 教えてもらえなければ、OS だけで決める
  }
  return platformOf(navigator.userAgent, arch);
}

async function fetchReleases() {
  const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(String(res.status));
  return shippable(await res.json());
}

function link(asset, primary, s, lang) {
  const a = document.createElement('a');
  a.className = `btn ${primary ? 'btn-primary' : 'btn-ghost'}`;
  a.href = asset.browser_download_url;
  const name = document.createElement('span');
  name.textContent = s.format(asset.name);
  const note = cpuNote(asset.name, lang);
  const size = document.createElement('small');
  // CPU の注記は大きさと同じ小さい字で（ボタンの名前を長くしない）
  size.textContent = note ? `${note} · ${sizeOf(asset.size)}` : sizeOf(asset.size);
  a.append(name, size);
  return a;
}

const text = (tag, className, textContent) =>
  Object.assign(document.createElement(tag), { className, textContent });

/** ダウンロードのページ：最新の版の、OS ごとのボタンと「この PC」の印 */
async function renderDownloads(root, lang) {
  const s = STRINGS[lang];
  const mine = await detectPlatform();
  const card = mine ? root.querySelector(`[data-kind="${mine}"]`) : null;
  if (card) {
    card.classList.add('mine');
    card.querySelector('h3')?.append(text('span', 'badge-mine', s.mine));
  }
  // 状態の行は札の外（見出しの下）にあるので、ページ全体から探す
  const status = document.querySelector('[data-release-status]');
  let releases;
  try {
    releases = await fetchReleases();
  } catch (error) {
    if (status) status.textContent = s.unreadable(error instanceof Error ? error.message : '?');
    return;
  }
  const latest = releases[0];
  if (!latest) {
    if (status) status.textContent = s.none;
    return;
  }
  if (status)
    status.textContent = s.latest(latest.name || latest.tag_name, s.date(latest.published_at));
  for (const kind of KINDS) {
    const box = root.querySelector(`[data-kind="${kind.id}"] .files`);
    if (!box) continue;
    const assets = sortAssets(latest.assets.filter((a) => kind.test(a.name)));
    box.replaceChildren(
      ...(assets.length
        ? assets.map((a, i) => link(a, i === 0, s, lang))
        : [text('p', 'muted', s.missing)]),
    );
  }
}

/** 過去の版のページ：版ごとに、OS ごとのボタン */
async function renderArchive(root, lang) {
  const s = STRINGS[lang];
  let releases;
  try {
    releases = await fetchReleases();
  } catch (error) {
    root.replaceChildren(
      text('p', 'note', s.unreadable(error instanceof Error ? error.message : '?')),
    );
    return;
  }
  if (!releases.length) {
    root.replaceChildren(text('p', 'note', s.none));
    return;
  }
  root.replaceChildren(
    ...releases.map((release) => {
      const article = document.createElement('article');
      article.className = 'release';
      const header = document.createElement('header');
      header.append(
        text('h3', '', release.name || release.tag_name),
        Object.assign(document.createElement('time'), {
          textContent: s.date(release.published_at),
          dateTime: release.published_at,
        }),
      );
      if (release.prerelease) header.append(text('span', 'chip wait', s.pre));
      const assets = document.createElement('div');
      assets.className = 'assets';
      for (const kind of KINDS) {
        for (const asset of sortAssets(release.assets.filter((a) => kind.test(a.name)))) {
          const a = link(asset, false, s, lang);
          a.prepend(text('b', '', kind.label[lang]));
          assets.append(a);
        }
      }
      const notes = Object.assign(document.createElement('a'), {
        href: release.html_url,
        textContent: s.notes,
      });
      article.append(
        header,
        assets.childElementCount ? assets : text('p', 'muted', s.noAssets),
        notes,
      );
      return article;
    }),
  );
}

/** トップの「ダウンロード」ボタンに、見ている PC の名前を添える */
async function labelHeroButton(button, lang) {
  const mine = await detectPlatform();
  const kind = KINDS.find((k) => k.id === mine);
  const small = button.querySelector('small');
  if (kind && small) small.textContent = kind.label[lang];
}

if (typeof document !== 'undefined') {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'ja';
  const downloads = document.querySelector('[data-downloads]');
  if (downloads) renderDownloads(downloads, lang);
  const archive = document.querySelector('[data-archive]');
  if (archive) renderArchive(archive, lang);
  document.querySelectorAll('[data-hero-download]').forEach((b) => labelHeroButton(b, lang));
}
