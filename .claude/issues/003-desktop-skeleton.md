# 003 — デスクトップ骨格の選定と初期化（TDD / CI 込み）

- Phase: 1
- 前提: 002（Adapter 境界。ここでコア側が何を持つかが決まる）

## 目的

クライアント側の技術基盤を決め、動く骨格を置く。

## 決めること（このリポで決めてよい・企画側へ選択肢を投げ返さない）

- デスクトップの実装方式（原案は Tauri + TypeScript + Rust を想定。**採るなら理由を、採らないなら代替を ADR に書く**）
- テストフレームワークと CI
- パッケージマネージャ（Node を使う場合は **pnpm 必須・npm 禁止**）

## 判断材料

**この製品の骨格の要件は、普通のデスクトップアプリと 1 点だけ違う。**

> **他プロセスの映像（scrcpy / ブラウザ）を、遅延なくウィンドウ内に出せること。**

ここが成立しない方式を選ぶと、後から直せない。C4 のとおりライブビューが芯なので、**映像の埋め込み方式を先に確かめてから骨格を決める。**

- 埋め込む方式（子ウィンドウを重ねる / 映像ストリームを取り込んで描画 / 外部ウィンドウを並べる）で、それぞれ遅延と実装コストが変わる
- 3 カラム UI（初期の企画草案 §12）の中央がこの映像枠になる

## 作業内容

1. **映像の埋め込み方式を先に試す**（骨格の選定より前）
2. 技術選定を行い、理由を ADR に残す
3. 骨格を初期化し、起動して空の 3 カラムが出るところまで
4. テストを 1 本書き、CI で green にする
5. README に起動手順を書く

## 完了条件

- `gh run list --limit 3` で CI が success
- テストが 1 本以上あり、CI で実行されている
- README の手順どおりに、別の PC で起動できる
- 技術選定の ADR がある。**映像の埋め込み方式について実際に試した結果が書かれている**

## 確認コマンド

```bash
gh run list --limit 3
```

## 注意

- **OSS 公開が確定している**（C15・2026-08-15）。commit に個人名・個人メールを残さない。**検出 CI を初回 commit から入れる**（後入れだと、それまでの commit が残る）

## 作業ログ

### 2026-08-17 — 作業内容 1（映像の埋め込み方式）を実測した

**実機は無い**（adb / scrcpy が手元に無い）。scrcpy が吐くのは「生 H.264（Annex-B）の 1 本のストリーム」なので、**同じ形を ffmpeg で作って代役にした**。ここで確かめたいのは端末との接続ではなく、その映像を GUI の中に遅延なく出せるかだけ。

- スパイク: `spikes/live-view/`（`server.mjs` が ffmpeg を起動して HTTP chunked で流し、`index.html` が WebCodecs で復号して canvas に描く）
- 測った環境: Windows 11 / Chromium 系ブラウザ（Tauri が Windows で使う WebView2 と同じエンジン）
- 結果（31 秒時点）: 受け取り 1892 / 描画 1891（取りこぼしなし）・60.3 fps・復号の待ち 2.9 ms・最初の絵まで 648 ms・送り手との差 3 → 9 枚
- 途中で 1 フレームが複数スライスに割れて復号器が落ちた。`first_mb_in_slice` で先頭スライスを判定して解決（詳細は ADR）

→ **方式 A（ストリームを取り込んで自前で描く）＋ Tauri** に決めた。ADR: `docs/adr/0002-live-view-embedding.md`（弱いところ 4 点・覆すべき条件 3 点も記載）

CI に `verify`（format / lint / typecheck / test）を足した（`.github/workflows/verify.yml`）。それまで CI で走っていたのは個人情報チェックだけで、テストは手元でしか走っていなかった。

**残り**: 作業内容 3（骨格の初期化・空の 3 カラム）/ 4（テスト）/ 5（README の起動手順）。**画面はまだ 1 枚も無い。**

### 2026-09-01 — 作業内容 3・4・5（骨格の初期化・テスト・README）

**開発機（Apple Silicon の Mac mini）が未構築だったので、先に環境を作った。**

- Node 20.5.0 → **22.23.2**（`package.json` の `engines` は `>=22`）／ pnpm 11.1.1 を corepack で有効化／ rustup で stable
- **ターミナルが Rosetta 下だった**（`sysctl.proc_translated = 1`）。nodebrew が Node を x64 で取得し、rustup は arm64 を入れたため CPU が食い違っていた。**Node を arm64 で入れ直した**（結果、`@tauri-apps/cli-darwin-arm64` が解決された）。README に確認手順を書いた
- `pnpm install` → `pnpm verify` で**既存の 104 件が手元でも通ることを確認**した

**置いたもの**: `packages/desktop`（Vite + Tauri 2.11.4 / tauri 2.11.3）

- `src/columns.ts` — 3 カラムの構成。中央がライブビュー（C4 / PRD §2）
- `src/render.ts` — DOM へ描く。幅は `--column-flex` で CSS へ渡し、**CSS に数字を書かない**
- `src-tauri/` — Tauri シェル。`identifier` は `dev.gitqa.desktop`、`authors` は置かない（§25）、CSP を `default-src 'self'` 基点で設定
- テスト **13 件**（`columns.test.ts` 7 / `render.test.ts` 6・happy-dom）。**中央が左右より広いことをテストで固定した**

**通ったもの**（実測）

| | 結果 |
|---|---|
| `pnpm verify` | format / lint / typecheck **OK**、テスト **117 件全て通過**（既存 104 + 新規 13） |
| `cargo check`（src-tauri） | **exit 0**・1m 16s |
| `pnpm --filter @git-qa/desktop build` | `dist/web` を出力（index.html 0.50 kB / css 0.53 kB / js 1.60 kB） |
| `bash .github/scripts/oss-privacy-check.sh` | **OK**（個人情報の混入なし） |

**副次の修正 2 件**

- prettier と eslint が `src-tauri/target/` を歩いて落ちたので、両方の除外に加えた
- **Tauri 既定の 2 倍解像度アイコン（ファイル名にアットマークを含む）を、個人情報チェックがメールとして誤検出した。**ファイル名がメールの正規表現に一致する。ハイフン区切りへ改名し、`tauri.conf.json` を追随させた。**検査スクリプトは共通雛形の正本なので触っていない。**`tauri icon` でアイコンを再生成すると同じ名前が復活するので、そのときは再度改名すること

**決めていないこと**: 色・タイポグラフィ・アイコン。`DESIGN.md` が全項目空で、見た目は人が決める領域（§11）。骨格は OS の既定の配色で出る。

**まだ満たしていない完了条件**

- `gh run list --limit 3` で CI が success — **未確認。**`gh` は入れたが**未ログイン**（認証情報の投入は人の作業・§14）。かつ **push は人間**（§6）なので、CI はまだ 1 度も走っていない
- README の手順どおりに**別の PC で起動できる** — **この 1 台でしか確認していない**
- 空の 3 カラムが実際に出ているかの**画面の確認は人が行う**（§29）

## 結果

（完了時に追記。**現時点では未完了** — 完了条件 4 つのうち満たしたのは ADR とテストの 2 つ。CI の success と別 PC での起動が未確認）
