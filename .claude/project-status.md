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

## 未完了の作業

- **Issue 006 は close していない。**完了条件 4 つのうち「録画あり / なしの両方で**走らせ**、区別がつく」だけ未達（実行器が無いため、スキーマ上表せるところまで）
- Issue 002（Adapter 境界の定義・Fake・ADR）— 未着手
- Issue 010（既存 OSS の実地調査と「作らない」判定）— 未着手
- Issue 003（デスクトップ骨格）— 未着手
- Issue 007（Git LFS の試算）— 未着手

## 次のタスク

1. Issue 010 — 作る前に既存 OSS を調べる
2. Issue 002 — Adapter 境界を決め、Fake で `run.json` を 1 本出す（Issue 006 の残り 1 条件はここで確かめる）

## 技術的決定

`.claude/decisions.md` を参照（C1〜C23）。2026-08-17 に C17〜C23 を追加。

## テスト状況

| | |
|---|---|
| テスト | **55 件・全て通過**（4 ファイル） |
| カバレッジ | statements 99.49% / branch 89.88% |
| 個人情報チェック | `bash .github/scripts/oss-privacy-check.sh` → OK |

**まだ実機で 1 回も走らせていない。**通っているのは TSV の読み込みと `run.json` の形の検証だけ。

## 既知の問題

- **Issue 001 / 004 / 005 が止まっている** — adb + scrcpy と実機が手元に無い。**勝手に調達しない**（人の判断が要る）
- **主指標（同じケース群の所要時間・C7）をまだ 1 度も測っていない。**測る対象の選定は Issue 009（owner-task）
