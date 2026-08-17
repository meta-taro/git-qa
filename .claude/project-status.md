# プロジェクトステータス — git-qa

- **現在フェーズ**: Phase 1（入力と出力の形を決める）着手中
- **最終更新**: 2026-08-17

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

## 未完了の作業

- **Issue 006 は close していない。**残り 1 条件は Fake アダプタ上で確認できたが、**実機で 1 回も走らせていない**
- **Issue 002 も close していない。**完了条件のうち「**Android 実装がそのインターフェースを満たしている**」が未達（実機・adb が無い）
- Issue 010（既存 OSS の実地調査と「作らない」判定）— 未着手
- **Issue 003（デスクトップ骨格）— 作業内容 1・2（実測と技術選定）まで。3〜5（骨格の初期化・テスト・README）が残り。画面はまだ 1 枚も無い**
- Issue 007（Git LFS の試算）— 未着手

## 次のタスク

1. Issue 003 の残り — Tauri 骨格を初期化し、空の 3 カラムが出るところまで
2. Issue 010 — 作る前に既存 OSS を調べる

## 技術的決定

`.claude/decisions.md` を参照（C1〜C27）。2026-08-17 に C17〜C27 を追加。

## テスト状況

| | |
|---|---|
| テスト | **104 件・全て通過**（8 ファイル） |
| カバレッジ | statements 99.42% / branch 93.65% |
| 個人情報チェック | `bash .github/scripts/oss-privacy-check.sh` → OK |

**まだ実機で 1 回も走らせていない。**通っているのは TSV の読み込み、`run.json` の形の検証、Fake アダプタに当てた契約テストと通し実行だけ。**Fake が通ることは、Android で動くことの確認ではない。**

**画面はまだ 1 枚も無い**（Issue 003 未着手）。この製品の主媒体はライブ映像（C4）で、そこを人が見て名前を置く。**現時点で人が触れるものは何も出来ていない。**

## 既知の問題

- **Issue 001 / 004 / 005 が止まっている** — adb + scrcpy と実機が手元に無い。**勝手に調達しない**（人の判断が要る）
- **主指標（同じケース群の所要時間・C7）をまだ 1 度も測っていない。**測る対象の選定は Issue 009（owner-task）
