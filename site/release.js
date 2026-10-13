/* global document, fetch -- 配布ページの中で、ブラウザが読む */
// **版と落とす先を、Releases から読む。**
// 書き換え忘れで古い版を配らないため、ここは手で書かない。
// 読めないときは Releases のページへ落とす（リンクは HTML 側で既にそこを指している）。
// 日本語と英語の配布ページで共有する。文言は <html lang> で選ぶ（2026-10-13）。
(async () => {
  const 英語 = document.documentElement.lang === 'en';
  const 文言 = 英語
    ? {
        最新: (tag) => `Latest ${tag}`,
        配布中: (tag, 日付) => `Now shipping ${tag} (${日付}).`,
        読めない版: 'See Releases',
        読めない説明: 'Check the Releases page for the latest build.',
      }
    : {
        最新: (tag) => `最新 ${tag}`,
        配布中: (tag, 日付) => `${tag}（${日付}）を配っています。`,
        読めない版: 'Releases を見る',
        読めない説明: '最新の版は Releases のページで確かめてください。',
      };
  const 置く = (id, 文) => {
    const 所 = document.getElementById(id);
    if (所) 所.textContent = 文;
  };
  try {
    // **`releases/latest` は先出し版を返さない。**ベータのうちは先出しで配るので、一覧から取る。
    const 返り = await fetch('https://api.github.com/repos/meta-taro/git-qa/releases?per_page=10');
    if (!返り.ok) throw new Error(String(返り.status));
    const 並び = await 返り.json();
    const 版 = (Array.isArray(並び) ? 並び : []).find((x) => !x.draft);
    if (!版) throw new Error('版が無い');
    置く('ver', 文言.最新(版.tag_name));
    const 日 = new Date(版.published_at);
    const 日付 = `${日.getFullYear()}-${String(日.getMonth() + 1).padStart(2, '0')}-${String(日.getDate()).padStart(2, '0')}`;
    置く('when', 文言.配布中(版.tag_name, 日付));
    const 当てる = (リンク, 大きさ, 物) => {
      if (!物) return;
      const a = document.getElementById(リンク);
      if (a) a.href = 物.browser_download_url;
      置く(大きさ, `${物.name} · ${(物.size / 1024 / 1024).toFixed(1)} MB`);
    };
    const 探す = (合う) => (版.assets || []).find(合う);
    当てる(
      'dl-mac',
      'size-mac',
      探す((x) => x.name.endsWith('.dmg')),
    );
    // **x64 と ARM64 を取り違えない。**名前に入っている形で選ぶ（最初の .msi を採ると、どちらかに当たる）。
    当てる(
      'dl-win',
      'size-win',
      探す((x) => x.name.endsWith('.msi') && x.name.includes('_x64')),
    );
    当てる(
      'dl-win-arm',
      'size-win-arm',
      探す((x) => x.name.endsWith('.msi') && x.name.includes('_arm64')),
    );
  } catch {
    // **黙って古い物を配らない。**読めなかったことを出す。
    置く('ver', 文言.読めない版);
    置く('when', 文言.読めない説明);
  }
})();
