# git-qa

**AI と人が一緒に動作検証をするための QA ランナー。**

AI に検証を丸投げして「全部通りました」と言わせる道具ではありません。丸投げして事故が起きたとき責任を持つのは人であり、「AI がやりました」は通らないからです。

git-qa がやるのは、**人が責任を持つ前提のまま、その責任を果たすコストを下げる**こと。AI は代わりに判断せず、**見るための準備をして、見る場所を絞ります。**

> ⚠️ このリポジトリは開発中です。**まだ実機で 1 回も走らせていません。**
> 現時点であるのは、検証シート TSV の読み取り・`run.json` の型とスキーマ・Adapter の境界と Fake 実装・
> デスクトップ画面の骨格（空の 3 カラム）までです。
> 方向性は `PRD.md`、進め方は `.claude/roadmap.md`、いま何がどこまでかは `.claude/project-status.md` にあります。

## 考え方

### 主媒体はライブビュー

「1 ケース 1 動画」を証跡の中心に置くと、シークして、待って、見逃してもう一度戻ることになり、手でテストするより遅くなります。

実際には、人は AI が操作しているのを**その場でライブで見ています。**

| いつ | 誰 | 媒体 |
|---|---|---|
| **実行中** | **本人** | **ライブビュー（主役）** |
| 直後 | 本人 | 落ちたところの静止画 |
| 後から | 本人・第三者 | 動画 |

UI の中心は録画プレイヤーではなく、いま動いている画面のミラーリングです。遅延がそのまま体験の質になるため、Android は scrcpy 前提、Web は headed のブラウザをそのまま見せます（スクリーンショット連写は使いません）。

### 人が見るのは 3 つだけ

全ケースを人が確認する道具にすると使われなくなります。人が見るのは、

- AI が判断できないと言ったところ
- 前回と差分が出たところ
- 落ちたところ

残りは `AUTO_PASS` のまま置きます。

### 結果の語彙

| 値 | 意味 |
|---|---|
| `VERIFIED` | **人が名前を置いた** |
| `AUTO_PASS` | AI が通した。**誰も見ていない** |
| `FAIL` | 落ちた |
| `BLOCKED` | 前提が整わず実行できなかった |
| `SKIP` | 実行しなかった |

素の `PASS` だと上 2 つが同じ値に潰れます。潰すとこの製品の意味がなくなります。

`VERIFIED` を中身を見ずに置くこともできますが、**それは仕様であって欠陥ではありません。**置いた瞬間にその人の名前が証跡に残る、ロックではなく署名です。不正防止機構は作りません（作ると、楽をするための道具が重くなります）。

## 対象

ライブ映像を出せるものが Adapter に入ります。

| 対象 | 扱い |
|---|---|
| Web | Adapter（Playwright） |
| Android | Adapter（ADB / scrcpy） |
| iOS | **未確定** — Windows から実用的な遅延で画面を見られるかを検証中 |
| デスクトップアプリ | Adapter |
| API / CLI / バッチ | 別扱い（ログのライブ追尾という別の見せ方が要る） |

## 成功の測り方

> **同じ 20 ケースを、手で通した所要時間と、この道具で通した所要時間。後者が明確に短いこと。**

この数字が出ないなら、他が全部できていても MVP ではありません。

## 非目標

- Appium / Maestro / scrcpy / Playwright の再実装
- クラウド Device Farm
- SaaS 化
- CI/CD の置き換え
- 独自 AI モデルの開発
- 不正防止機構
- 全ケースの人間確認を強制する仕組み

## 必要なもの

| | 版 | 用途 |
|---|---|---|
| Node.js | **22 以上** | フロントのビルドとテスト |
| pnpm | `package.json` の `packageManager` に従う | **pnpm のみ。npm / yarn は使わない** |
| Rust (stable) | 1.77.2 以上 | デスクトップ画面（Tauri）のビルド |

pnpm は corepack で入れます（別途 install しない）。

```bash
corepack enable
```

Rust は rustup で入れます。

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

OS ごとに Tauri の前提が別途あります（macOS は Xcode Command Line Tools、Windows は WebView2 と MSVC build tools、
Linux は webkit2gtk）。詳細は [Tauri の前提条件](https://v2.tauri.app/start/prerequisites/) を参照してください。

### Apple Silicon の Mac で作業する場合

**ターミナルが Rosetta で起動していないことを確認してください。**

```bash
uname -m      # arm64 であること（x86_64 なら Rosetta 下にいる）
node -p process.arch   # arm64 であること
```

Rosetta 下だと Node が x64 で入り、Rust は arm64 で入るため、Tauri CLI のネイティブモジュールと
cargo のビルドで CPU が食い違います。ターミナルの「情報を見る」で「Rosetta を使用して開く」を外してください。

## セットアップ

```bash
pnpm install
cp .env.example .env   # 必要な値を設定
```

## 開発

```bash
pnpm verify            # format:check → lint → typecheck → test（commit 前に通す門）
pnpm lint              # Lint
pnpm typecheck         # 型チェック
pnpm test:run          # テスト
pnpm test:coverage     # カバレッジ
```

### Android 実機・エミュレータに当てるテスト

`packages/adapter-android` のテストのうち、実機に繋ぐ 4 件は**既定では走りません**。
`adb devices` で端末が見えている状態で、次のように実行します。

```bash
GIT_QA_ANDROID_E2E=1 pnpm test:run
```

端末が無い環境では、この 4 件は自動的に飛びます（残りはすべて adb / scrcpy を差し替えて走ります）。
別途 `adb` と `scrcpy` が PATH に要ります。

### デスクトップ画面を起動する

```bash
pnpm --filter @git-qa/desktop tauri dev
```

初回は Rust の依存をまとめてビルドするため数分かかります。**空の 3 カラム（ケース / ライブビュー / 判定）が出れば成功です。**
中身はまだありません。

ブラウザだけで画面を見る場合（Rust 不要）:

```bash
pnpm --filter @git-qa/desktop dev   # http://localhost:1420
```

配布物を作る場合:

```bash
pnpm --filter @git-qa/desktop tauri build
```

> 見た目の方向は `DESIGN.md` にあります。アクセント色は `#0F768E`（青緑）で、
> **使い所は「いま人がやること」1 つだけ**。それ以外は OS の色を使います。
> 字面（フォント）はまだ決めていません。
> アイコンも Tauri の既定のままです。

### アプリを叩くだけで動かす（配布物）

`.app` を起動すると、**アプリ自身が Node 側（入口サーバと実行器）を起こします。**
ターミナルは要りません。

- **Node が要ります**（`adb` と同じで、この道具が前提にする外部のもの）。
  見つからないときは、その理由が画面に出ます
- 開発中（`pnpm app`）は Node 側が既に起きているので、アプリは二重に起こしません

### 配布物（.app / .dmg）を作る

```bash
pnpm --filter @git-qa/desktop tauri build
```

`packages/desktop/src-tauri/target/release/bundle/` に `.app` と `.dmg` が出ます。

> **開発中の起動（`pnpm app` / `pnpm live`）ではアイコンが出ません。**Dock のアイコンは
> `.app` の包みに入っているもので、開発中は実行ファイルを直接動かしているためです。
>
> **署名も公証もしていません。**ブラウザで配布物を落とすと Gatekeeper に止められます
> （鍵の投入は人の作業・§14）。**自動更新もまだ入れていません。**

### アプリから始める（推奨）

```bash
pnpm app
```

**ターミナルで打つのはこの 1 行だけ**です。アプリが開いたら、中で

1. 端末を選ぶ（`adb` で見えているものが並びます）
2. 検証シートを選ぶ（このリポジトリの中から `.tsv` を探して並べます）
3. 「実行を始める」を押す

> **ウィンドウを完全に隠すと、macOS が画面の時計を止めます。**その間は状態の取り直しが
> 止まりますが、**前面に戻すと取り直します**（実測で確認した挙動）。

### エミュレータを起こす

```bash
~/Library/Android/sdk/emulator/emulator -avd <AVD 名> -no-window -no-audio -gpu host
```

**`-gpu host` を必ず付けてください。**付けないと GPU が SwiftShader（CPU での描画）になり、
**操作から画面に出るまでが 1.1 秒**まで落ちます（`-gpu host` なら 136〜221 ms・2026-09-02 実測）。

```bash
# いま何で描いているかの確認
adb shell dumpsys SurfaceFlinger | grep GLES:
```

### 端末に繋いで、画面に映す

```bash
pnpm live
```

Android 端末（またはエミュレータ）へ `adb` で繋ぎ、`screenrecord` の生 H.264 を localhost の橋に流し、
その URL を付けて Tauri を起動します。**中央のカラムに端末の画面が出れば成功です。**

- 端末を選ぶ: `GIT_QA_ANDROID_SERIAL=emulator-5554 pnpm live`
- 映らない場合は、その理由が中央のカラムに出ます（console だけには出しません）

> **枠の中に映像が描かれるところは、まだ人の目で確認できていません。**橋が映像を流すところまでは
> 実測済みです（6 秒で 2.8 MB）。

### 検証シートを 1 本走らせる

```bash
pnpm run:sheet packages/core/test/fixtures/sample-notes-app.tsv
```

シートを読み、AI が端末を操作し、**人が横で見て 1 打鍵で判定を置く**までを 1 本で走らせます。
終わると `runs/<runId>/run.json` が出ます（`runs/` は Git に入れません）。

| キー | 置くもの |
|---|---|
| `v` | `VERIFIED`（見た。合格） |
| `f` | `FAIL`（見た。不合格） |
| `b` | `BLOCKED`（人にも判断できない） |
| `s` | `SKIP`（今回は見ない） |
| `Space` | 置かずに次へ（`AUTO_PASS` のまま残る） |

**人が押すまで次のケースへ進みません。**時間で勝手に進めると、見ようとしていたケースを
見逃したまま `AUTO_PASS` が積み上がるためです。

- 置いた人の名前: `GIT_QA_OPERATOR=<handle> pnpm run:sheet ...`（個人名ではなくハンドル）
- **押し間違いは取り消せません**（`u` は未実装）。確定した判定を直すには、その行を走らせ直します

> **実機・エミュレータで通した実績はまだありません。**代役の端末（テスト用のアダプタ）で
> 5 ケースを通し、`run.json` に `VERIFIED` と `AUTO_PASS` が混ざることまでは検査で確認しています。

### AI に端末を触らせる（MCP）

```bash
pnpm mcp
```

Claude Code などの MCP クライアントから、端末を触って画面を取れます（`.mcp.json` に登録済み）。

| 道具 | できること |
|---|---|
| `device_tap` | 1 点タップする |
| `device_swipe` | なぞる（速さでフリックになる） |
| `device_key` | HOME / BACK / APP_SWITCH などを送る |
| `device_screenshot` | いまの画面を PNG で取る |
| `device_screen_text` | 画面で読める文字を取る |
| `device_screen_size` | 端末の実寸（座標を決めるのに使う） |

> **判定を置く道具はありません。**`VERIFIED` を AI が置けるようにした瞬間、この製品の芯
> （人が見て保証したことが証跡に残る）が壊れます。**AI にできるのは操作と取得まで。合否は人だけ。**

## ルール

このリポジトリは AI エージェント開発のベースルールに従います。詳細は `.claude/rules/product-baseline.md` と `CLAUDE.md` を参照してください。

- pnpm のみ使用（npm / yarn 禁止）
- commit は AI、push は人間（人間確認なしの push 禁止）
- テスト後回し・削除禁止
