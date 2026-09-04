# macOS で配るときの注意（Info.plist と署名）

> 2026-09-04 に、別プロダクト（warifu）で「許可のダイアログがたびたび出る」「カメラが動かない」
> という報告があり、原因が 2 つに切り分けられた。**git-qa も同じ 2 つを踏んでいた**ので、
> 分かったことをここに残す。

## 1. 使用目的の記述が無いと、OS は渡さない

macOS は `NS...UsageDescription` が無いアプリに、その資源を渡さない。**黙って渡さない**ので、
アプリ側からは「空だった」「見つからなかった」としか見えない。

git-qa がこれを踏む場所は**ファイル欄**である。Finder から起動されると作業ディレクトリが `/`
になるため、検証シート（TSV）をホームの下から探す（`packages/host/src/app-cli.ts`）。
記述が無いと、そこが 0 件になる — つまり「**検証シートが選べない**」が別の理由でまた起きる。

`packages/desktop/src-tauri/Info.plist` に 3 つ置いてある。

| キー | 何のため |
|---|---|
| `NSDocumentsFolderUsageDescription` | 書類フォルダから検証シートを探す |
| `NSDesktopFolderUsageDescription` | デスクトップから検証シートを探す |
| `NSDownloadsFolderUsageDescription` | ダウンロードから検証シートを探す |

**使っていないものは書かない。**git-qa はカメラもマイクも使わないので、その 2 つは書いていない
（`packages/desktop/test/tauri-config.test.ts` がそれを守る）。

ローカルネットワークの記述（`NSLocalNetworkUsageDescription`）も**要らない**。
橋も準備用の口も **127.0.0.1 にだけ**待ち受けており、loopback は OS の対象外だからである。
ここを 0.0.0.0 へ広げると要るようになる — が、そのときは記述を足す前に、
**なぜ広げるのかを決め直すこと**（C33 の前提が変わる）。

建てたあと、実物に入ったことを確かめる:

```bash
plutil -p packages/desktop/src-tauri/target/release/bundle/macos/git-qa.app/Contents/Info.plist \
  | grep UsageDescription
```

## 2. ad-hoc 署名だと、許可を覚えてもらえない

macOS は**署名でアプリを見分けて**許可を覚える。既定の ad-hoc 署名は建て直すたびに別物になるので、
そのたびに聞き直される。「たびたび出る」の正体はこれ。

いまの状態はこれで見られる:

```bash
codesign -dv --verbose=2 /Applications/git-qa.app
# Signature=adhoc / TeamIdentifier=not set  ← 建て直すたびに別のアプリとして扱われる
```

止めるには、手元の証明書で署名する。

```bash
security find-identity -v -p codesigning     # 使える証明書を見る
export APPLE_SIGNING_IDENTITY="…"            # 見えた名前を入れる
pnpm --filter @git-qa/desktop exec tauri build
```

**証明書の名前はこのリポジトリに書かない。**開発用の証明書には個人名が入っており、
public リポジトリに個人を残さない決まりだからである（product-baseline §25）。
**この作業は人が行う**（§14 — 秘密情報の投入は人の手）。

## 3. 覚えている許可を消したいとき

署名を変えると、OS から見て別のアプリになる。前の許可は残ったままなので、消したいときは
**システム設定 → プライバシーとセキュリティ**の各項目から手で外す。
