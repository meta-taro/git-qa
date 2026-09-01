# プロジェクトステータス — git-qa

- **現在フェーズ**: Phase 1（入力と出力の形を決める）着手中
- **最終更新**: 2026-09-02

## 完了した作業

### リポジトリの土台（2026-08-17）

pnpm workspace / TypeScript 5.9（NodeNext・strict）/ Vitest 3 / ESLint 9 flat config / Prettier 3。
`pnpm verify` で format:check → lint → typecheck → test を一括で回す。

- `.gitattributes` — 検証シート TSV を改行正規化から外す（C21）
- `.prettierignore` — Markdown と TSV は整形しない（C22）
- `pnpm-workspace.yaml` の `allowBuilds` は `esbuild` のみ（C23）

### `packages/core`（Issue 006 の大部分・2026-08-17）

- **検証シート TSV の読み込み** — `parseTestSpecTsv` / `readTestSpecTsv`。読むだけで書き込む口を持たない（C3）
- **`run.json` のスキーマ** — `packages/core/schema/run.schema.json`（JSON Schema draft 2020-12）が正本、TS の型は写し（C18）。検証は ajv
- **結果の語彙を AI 側と人側で型ごと分けた**（C17）。AI は `VERIFIED` を値として持てない
- **録画は 4 状態**（C20）。「録画オフ」と「録画失敗」が区別できる

### Adapter の境界（Issue 002 の大部分・2026-08-17）

- **インターフェース定義** — `packages/core/src/adapter/`。**ライブ映像を出せることを型で必須**にした（C24）
- **画面の状態は生データを素通し**（`Observation.raw: unknown`）。共通の型へ潰さない
- **契約テスト** — `test/adapter/contract.ts`。実装ごとに当てる束。Android / Web を足すときの答え合わせになる
- **Fake アダプタ**（C25）— 実機なしで芯を通しで動かすため
- ADR — `docs/adr/0001-adapter-boundary.md`（Web を当てたときの足りない / 余るを列挙）

### 実行器（Issue 006 の残り・2026-08-17）

`packages/core/src/run/execute.ts` / `write.ts`。**シートを読む → 繋ぐ → ライブビューを開く → 走らせる → 人が名前を置いた行だけ `VERIFIED` → `run.json` を書く**までが 1 本に繋がった。

- 繋ぐ前にシートを検証して落とす。途中では落とさず `FAIL` にして続ける（C26）
- 録画はケースの操作までで閉じる。人が考えている時間を動画に入れない（C26）
- `run.json` はスキーマを通らなければ書かない・同じ `runId` に 2 度書かない（C26）
- `test/run/end-to-end.test.ts` — 実フィクスチャ 5 行を録画あり / なしで 2 回走らせ、`run.json` を読み返す。**AI は 5 件とも `PASS` を返しているのに `VERIFIED` は人が見た 1 件だけ**、が証跡の上で読める

### 映像の埋め込み方式の実測（Issue 003 の作業内容 1・2026-08-17）

**骨格を選ぶ前に、この製品に固有の要件を測った**（他プロセスの映像を遅延なくウィンドウ内に出せるか・C4）。

**実機は無いので、scrcpy が吐く形（生 H.264 Annex-B）を ffmpeg で作って代役にした。**確かめたのは端末との接続ではなく、その映像を GUI の中に出せるかだけ。

- スパイク: `spikes/live-view/`（**製品のコードではない。`packages/` からは参照しない**）
- 結果（Windows / Chromium・31 秒）: 取りこぼしなし・60.3 fps・復号の待ち 2.9 ms・最初の絵まで 648 ms
- → **方式 A（自前で描く）＋ Tauri** に決定（C27）。ADR: `docs/adr/0002-live-view-embedding.md`
- CI に `verify`（format / lint / typecheck / test）を追加。**それまで CI で走っていたのは個人情報チェックだけだった**

### デスクトップ骨格（Issue 003 の作業内容 3〜5・2026-09-01）

**`packages/desktop` を置いた。空の 3 カラムが Tauri のウィンドウに出るところまで。**

- 開発機（Apple Silicon の Mac mini）が未構築だったので先に環境を作った。Node 22.23.2 / pnpm 11.1.1 / rustup stable
- **ターミナルが Rosetta 下だった**（`sysctl.proc_translated = 1`）。Node が x64・Rust が arm64 で食い違っていたので **Node を arm64 で入れ直した**。README に確認手順を書いた
- 構成は `src/columns.ts` に一本化し、幅は `--column-flex` で CSS へ渡す。**CSS に数字を書かない**（C28）
- **中央（ライブビュー）が左右より広いことをテストで固定**（C4 を壊せなくする）
- `cargo check` **exit 0**（1m 16s）。`tauri dev` でウィンドウが起動するところまで確認
- **色・タイポグラフィ・アイコンは決めていない。**`DESIGN.md` が空で、見た目は人が決める領域（§11）

### macOS でのライブ映像の実測（ADR 0002 の「覆すべき条件」1 つ目・2026-09-02）

**Tauri のウィンドウの中（WKWebView）で測った。**Windows の測定は Chrome で行っており、
「Tauri のシェルの中では測っていない」という弱点も同時に潰した。

- **macOS で WebCodecs の H.264 復号は使える。**覆すべき条件の 1 つ目は成立しない
- 最初の絵まで 103 ms / 97 秒で描画 5832・理想 5832（取りこぼし無し）/ 復号の待ち 6.6〜17.2 ms
- **スパイクに実在のバグがあった。**パラメータセット（SPS / PPS）を直前のフレームの chunk の末尾に
  ぶら下げていた。**Chromium は通すが WebKit は `Decoder failure` で停止**。59 枚で止まっていた原因。
  実機の scrcpy でも起きうる種類のバグ
- 計測中の周期的な停止は**画面がロックされていた**ため（最前面が `loginwindow`）。Safari でも同じに
  なるので製品側のリスクではない。**画面を見える状態にしての通し計測は未実施**

### Android エミュレータが動いた。実機由来の H.264 でも通した（2026-09-02）

**この Mac に Android Studio の SDK と AVD が既にあった。**Pixel 3a / API 31 を `-no-window` で
起動（13 秒）。scrcpy 4.1 と adb を入れて繋いだ。

- **scrcpy が実際に吐いた H.264 を、再エンコードせずスパイクへ流して復号できた**（エラー 0 件・
  最初の絵まで 125 ms・復号の待ち 7.5〜7.8 ms）。ADR 0002 の弱点「実機の scrcpy で測っていない」が
  ここまで潰れた。**ただしエミュレータであって実機ではなく、確かめたのは復号だけ**
- **scrcpy は画面が変化したときしかフレームを作らない。**60 秒の録画で映像は 33 秒・平均 10 fps

### 証跡の保管費の試算（Issue 007・2026-09-02）

**最初 8 Mbps の上限で置いた試算は 11 倍過大だった。**エミュレータで実測して置き直した。

| | 上限で置いた場合 | **実測ベース** |
|---|---|---|
| 1 ケース（実時間 60 秒） | 60 MB | **5.05 MB** |
| 20 ケース × 20 営業日 | 24 GB / 月 | **2.12 GB / 月** |
| 無料枠 10 GiB まで | 約 9 営業日 | **累積で 5.1 か月** |
| Team / EC 250 GiB まで | 11.2 か月 | **累積で 127 か月** |

- → **決定（C29）は変わらない。動画は既定で Git に入れない。**`runs/` を `.gitignore` に入れた
- **理由の重心が変わった。**「すぐ破綻する」ではなく「**履歴に入る以上は青天井に累積するので、
  固定枠はいつか必ず超える**」＋「**溜まった履歴を 1 回 clone しただけで月間帯域を超える**」
- **Team / EC なら LFS は 10 年以上もつ。**「LFS は無理」ではなく「**無料枠では無理**」が正しい
- **動画を Git に入れない運用でも製品は成立する**（`CaseRecording` の `not_requested` と、録画あり /
  なしの 2 回を走らせる end-to-end テストで確認済み）

### 既存 OSS の調査（Issue 010・2026-09-02・途中）

**触った 5 つのいずれも、観点 2（`VERIFIED` と `AUTO_PASS` を別の値として残す）を満たさない。**
結果の語彙はどれも「通った / 落ちた」で、**誰が見たかを持つ項目が無い。**

| | 結果の語彙（実物） |
|---|---|
| Playwright | `'passed' \| 'failed' \| 'timedout' \| 'interrupted'` |
| Maestro CLI | `SUCCESS` / `ERROR`（JUnit 出力） |
| Allure Report | `status` ＋ 自由な `labels`（メタデータであって結果の値ではない） |
| scrcpy | 結果という概念を持たない（持たないのが正しい） |
| Appium | WebDriver のサーバで結果の概念を持たない（層が違う） |

**判定はまだ書かない。**未検証が 3 つあり、うち 2 つは「人の判定」を持つ可能性が残っている。

- **ReportPortal** — Docker のデーモンが動かず未検証（起動は GUI 操作＝画面ロック中は不可）
- **Allure TestOps（商用）** — 手動テストと人の判定を持つ側。OSS の Report しか触っていない
- **Maestro Studio / Appium Inspector** — どちらも GUI アプリで、画面がロックされていて起動できない
  （**`maestro studio` は CLI から消え、独立したデスクトップアプリになっていた。調査対象リストが古い**）

**Appium は部分的にしか触れていない。**サーバ 3.7.0 は動くが、driver の導入が pnpm 管理下で失敗する
（Appium が内部で npm を呼ぶため）。セッションを張るところまで行っていない。

### 提案（決定ではない）— Phase 4 の `device.*` を自作しない

**`maestro mcp` が `list_devices` / `take_screenshot` / `run` / `inspect_screen` /
`open_maestro_viewer` を MCP で出している。**`.claude/roadmap.md` の Phase 4 で git-qa が
自分で出そうとしている **`device.*` とほぼ同じ**。**そして `human.*` に当たるものは無い。**

→ **端末操作の MCP を自作せず Maestro に寄せることを検討したい。**自作すると非目標に挙げた
「Maestro の再実装」に近づく。**これは提案であって決定の変更ではない**（§15）。
**Issue 010 の未検証 3 つを潰してから、判定と一緒に出すのが順当。**

### Android アダプタ（Issue 004 の前提・2026-09-02）

**`packages/adapter-android` を置き、エミュレータに実際に当てた。**

- adb / scrcpy を呼ぶ口を**注入できる形**にした（C31）。純粋な部分（引数の組み立て・
  端末一覧の解析・`input text` の escape・uiautomator から座標を出す）を分離
- **契約テストを端末なしで当てられる**ようにした。そのため契約テストを
  `@git-qa/core/testing` へ移した（C30）
- 実機の検査は `GIT_QA_ANDROID_E2E=1` のときだけ走る（§4）
- **テストが実装のバグを 1 つ捕まえた**（空の要素参照が `resource-id=""` のノードに当たる）

**Issue 002（Adapter の境界）の完了条件 4 つが揃った。**残っていた「Android 実装が
そのインターフェースを満たしている」が埋まり、**境界を引き直す必要は出なかった**
（コア側の変更ゼロ）。

## 未完了の作業

- **Issue 006 は close していない。**残り 1 条件は Fake アダプタ上で確認できたが、**実機で 1 回も走らせていない**
- **Issue 002 は完了条件が揃った。**ただし **close は `gh` が要る**ので保留
  （ローカルの `.claude/issues/002-*.md` には記録済み）。**当てたのはエミュレータで実機ではない**
- **Issue 010 は途中。**5 つ触ったが 3 つが未検証（ReportPortal は Docker、Maestro Studio と
  Appium Inspector は GUI）。**そのうち ReportPortal と Allure TestOps は「人の判定」を持つ
  可能性が残っている**ので、「作る / 作らない / 既存へ貢献する」の判定を書いていない
- **Issue 003 も close していない。**骨格は出たが、完了条件のうち 2 つが未確認
  - `gh run list --limit 3` で CI が success — **`gh` が未ログイン**（認証情報の投入は人・§14）。かつ **push は人間**（§6）なので CI はまだ 1 度も走っていない
  - README の手順どおり**別の PC で起動できる** — **この 1 台でしか確認していない**
- **Issue 007 も close していない。**既定は決まったが、完了条件 2 つが未達
  - 月額の試算 — **超過単価が一次情報から取れていない**（docs に記載が無く料金計算機へ誘導。
    加えて `github.com/pricing` が廃止済みのデータパックを今も表示しており一次情報が食い違う）。
    既定を「入れない」にしたので**既定の月額は 0** だが、オプトイン向けは出せていない
  - 1 ケースあたりの動画サイズは**実測ではなく上限での見積り**。実機の scrcpy が要る

## 次のタスク

1. **人**: `gh auth login`（このセッションでは 120 秒で切れた。別のターミナルで実行が要る）→ push → CI が success することの確認
2. **人**: 画面のロックを解いた状態で、空の 3 カラムが出ていることの確認（§29）
3. **人**: 料金計算機で Git LFS の超過単価を確認（Issue 007 の残り）
4. **Issue 004 の本体** — 一本道。判断保留の条件・キー割り当て・ケース間の遷移を決め、
   Issue 003 の画面とアダプタを繋ぐ。**`VERIFIED` を置く所は人が要る**
5. Issue 010 の残り — ReportPortal（Docker 起動が要る）/ Maestro Studio・Appium Inspector（画面が要る）。
   **どれも人の手が要る。**潰してから判定を書く
6. `DESIGN.md` を人が埋める。埋まるまで骨格に色は入れない（§11）

## 技術的決定

`.claude/decisions.md` を参照（C1〜C31）。2026-09-02 に C29（動画は既定で Git に入れない）・C30（契約テストの輸出）・C31（Android アダプタの作り）を追加。

## テスト状況

| | |
|---|---|
| テスト | **169 件・全て通過**（端末を繋ぐと **173 件**） |
| 内訳 | コア 104 / デスクトップ 13 / Android アダプタ 52 ＋ 実機 4（既定では飛ぶ） |
| カバレッジ | 未再計測（104 件時点で statements 99.42% / branch 93.65%） |
| 個人情報チェック | `bash .github/scripts/oss-privacy-check.sh` → OK |

**Android エミュレータには当てた**（2026-09-02）。繋ぐ・画面を読む・撮る・操作して画面が変わる、
までを実際の adb / scrcpy で確認している。**ただし実機ではない。**メーカー独自の UI・
uiautomator が返さない要素・USB の切断といった実機固有の癖は、ここでは出ない。

**通しの一本道はまだ走らせていない。**TSV を読んでケースを実行し、人が `VERIFIED` を置いて
`run.json` が出るまでは繋がっていない。

**画面は骨格だけ**（空の 3 カラム）。この製品の主媒体はライブ映像（C4）で、そこを人が見て名前を置くが、**中央の枠にはまだ何も映らない。**コアの実行器と画面は繋がっておらず、**人が触って検証を進められる状態にはなっていない。**

## 既知の問題

- **Issue 004 の前提は揃った。**アダプタはエミュレータで動く。残っているのは
  **一本道**（判断保留の条件・キー割り当て・ケース間の遷移・5 ケース通し）で、
  **`VERIFIED` を置くのは人**なので画面と人が要る（§29）
- **iOS（Issue 001）は依然として実機・環境の判断が要る。勝手に調達しない**
- **ライブビューはまだ scrcpy の別窓。**C27 で決めた「アプリの枠の中に描く」方式と
  Issue 003 の画面には**まだ繋いでいない**
- **Android SDK を二重に入れてしまった。**`~/Library/Android/sdk`（既存）に加えて brew で
  `/opt/homebrew/share/android-commandlinetools` を入れた。**既存を先に確認すべきだった。**
  使っているのは既存のほう。brew 側は `brew uninstall --cask android-commandlinetools` で消せる
- **主指標（同じケース群の所要時間・C7）をまだ 1 度も測っていない。**測る対象の選定は Issue 009（owner-task）
- **`gh` が未ログイン。**GitHub Issue とそのコメントを 1 件も確認できていない（close 済 Issue への後追い指示も未確認）。**人が `gh auth login` を実行する必要がある**（§14）
- **`DESIGN.md` が全項目空。**骨格は OS の既定の配色で出ている。**AI は埋めない**（§11）
- **Linux（WebKitGTK）で WebCodecs の H.264 復号を未測定**（ADR 0002 の「覆すべき条件」の 1 つ）。**macOS は 2026-09-02 に実測済で、成立しない**ことが分かった
