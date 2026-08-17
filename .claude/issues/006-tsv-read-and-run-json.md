# 006 — TSV の読み込みと run.json のスキーマ

- Phase: 1
- 前提: なし

## 目的

テストケースの入力と、実行結果の出力の形を決める。

## 決まっていること（変えない）

### git-qa は TSV を読むだけ。書き戻さない（C3）

- 結果は `run.json` に出す
- TSV への反映は **md-business** が行う（行 ID・`computed` 列・`hidden` 行を知っているのはあちら）
- エージェントが両方を呼んで橋渡しする

**理由**: TSV の書式規約を git-qa が抱えずに済み、md-business の仕様が変わっても追随不要になる。また md-business を持たない利用者が自前で書くと、集計列を実数で潰す・控えの行を復活させるといった壊し方をする。**読める形のまま壊れるので気づけない。**

### 結果の語彙（C1）

| 値 | 意味 |
|---|---|
| `VERIFIED` | **人が名前を置いた** |
| `AUTO_PASS` | AI が通した。**誰も見ていない** |
| `FAIL` | 落ちた |
| `BLOCKED` | 前提が整わず実行できなかった |
| `SKIP` | 実行しなかった |

**`VERIFIED` と `AUTO_PASS` を 1 つの値に潰さない。**潰すとこの製品の意味がなくなる。

### 録画したかどうかを残す（C11）

**動画が無いとき、「録画オフで走らせた」のか「録画に失敗した」のかが区別できること。**区別できないと、後から証跡として読めない。

## 決めること（このリポで決めてよい・企画側へ選択肢を投げ返さない）

- TSV の列（原案は `target` / `evidence` を足している。初期の企画草案 §7）
- `run.json` のスキーマ
- `runs/<ts>/<caseId>/` の中の並べ方

## 判断材料

`run.json` に入る見当（過不足はこの Issue で詰める）:

- 実行日時 / 実行者 / 実行モード
- 対象（デバイス名・OS バージョン・ブラウザ / **検証したビルドや commit**）
- ケースごとの `ai_result` / `human_result` / `result`
- **録画の有無と、無い場合の理由**
- ステップごとのタイムスタンプ（動画の頭出しに使う）
- Finding（ケースの合否とは別に見つけた問題）

## 完了条件

- スキーマがファイルとして存在する（JSON Schema など、機械で検証できる形）
- 実行前後で **TSV が書き換わらない**ことがテストで担保されている
- 録画あり / なしの両方で走らせ、`run.json` からその区別がつく
- `VERIFIED` と `AUTO_PASS` が別の値として出る

## 確認コマンド

```bash
git diff --name-only   # 実行後に TSV が出ないこと
```

## 作業ログ

### 2026-08-17

リポジトリの土台（pnpm workspace / TypeScript / Vitest / ESLint / Prettier）を置いたうえで、`packages/core` に 2 つを実装した。テストを先に書いてから実装している。

**1. 検証シート TSV の読み込み**（`src/tsv/`）

- `parseTestSpecTsv(text)` / `readTestSpecTsv(path)`。**読むだけで、書き込む口を持たせていない**（C3）
- 対応: マジック行（行頭 0 桁）/ メタ行 `# キー: 値` / ディレクティブ `#@` / ヘッダ `名前[:型][!]` / `enum(...)` / multiline 列の `\n` 復元 / 末尾の空セルを省いた短い行
- 知らないディレクティブは**捨てずに raw のまま持つ**。仕様は md-business 側にあるので、こちらが落とすと「あったはずの宣言が消えた」ことになる
- 落とすもの: マジック行なし・ヘッダ行なし・列名の重複・知らない列型・列数の超過。**text に丸めない**（丸めると型注釈が無い列と区別できなくなる）
- `.gitattributes` で `*.tsv -text`。CRLF を git の正規化から外した（C21）

**2. `run.json` のスキーマ**（`schema/run.schema.json` + `src/run/`）

- JSON Schema draft 2020-12 が正本、TypeScript の型は写し（C18）。検証は ajv
- 結果の語彙を AI 側と人側で型ごと分けた（C17）。**AI は `VERIFIED` を値として持てない**
- `resolveCaseResult` は「人の判断があればそれ、無くて AI が `PASS` なら `AUTO_PASS`」。見た人の判断が最後に来る
- 録画は 4 状態（C20）。`failed` / `unsupported` は理由が必須、`not_requested` には理由を書けない
- 「どの機体・どのビルドか」は TSV でなく `run.json` の `target` に持たせた（C19）。TSV には列を足していない
- `runs/<runId>/case-NNN/`。`runId` は `^[A-Za-z0-9._-]+$` 以外を弾く（`runs/` の外へ書く口を作らない）

**検証**（`pnpm verify` 全て緑）

```
prettier --check .   All matched files use Prettier code style!
eslint .             エラーなし
tsc --build --force  エラーなし
vitest run           4 files / 55 tests passed
vitest run --coverage  99.49% statements / 89.88% branch
git diff --name-only -- '*.tsv'   （空）
bash .github/scripts/oss-privacy-check.sh   OK
```

### 2026-08-17（追記）— 実行器を通した

`packages/core/src/run/execute.ts` と `write.ts` を足し、**シートを読む → 繋ぐ → ライブビューを開く → 走らせる → 人が名前を置いた行だけ `VERIFIED` → `run.json` を書く**までを 1 本に繋いだ。テストを先に書いている（`test/run/execute.test.ts` 23 件 / `write.test.ts` 4 件 / `end-to-end.test.ts` 2 件）。

- 走らせる前にシートを検証して落とす（`No.` 重複・非整数・`項目` 空・列の欠落）。**繋いでから落ちると、繋いだ意味がない**
- ケースが例外を投げても `FAIL` として残し、後続を続ける。**途中で止まると、走らせた分の証跡まで消える**
- 録画は「ケースの操作まで」で閉じる。人が考えている時間は動画に入れない
- `mode: 'auto'` なのに人へ聞く口がある／`assisted` なのに無い、は起動時に落とす
- `run.json` は**スキーマを通らなければ書かない**・**同じ `runId` に 2 度書かない**（前の実行を黙って消さない）

`end-to-end.test.ts` は実フィクスチャ（`sample-notes-app.tsv` の 5 行）を、録画あり / 録画なしの 2 回走らせて `run.json` を読み返している。**AI は 5 件とも `PASS` を返しているが、`VERIFIED` は人が名前を置いた 1 件だけ**であることが証跡の上で読める。

**ただし繋いでいるのは Fake アダプタで、実機ではない。**

## 結果

**完了条件のうち 3 つを満たし、1 つは部分的に満たした。**

| 完了条件 | 状態 |
|---|---|
| スキーマがファイルとして存在する | **満たした** — `packages/core/schema/run.schema.json`。ajv で検証、壊れた `run.json` が落ちることをテストで確認 |
| 実行前後で TSV が書き換わらない | **満たした** — 読み込み前後の sha256 が一致するテスト。確認コマンドの出力も空 |
| `VERIFIED` と `AUTO_PASS` が別の値として出る | **満たした** — 同じ `run.json` に両方が同居するテスト。AI 側の型に `VERIFIED` が無い |
| **録画あり / なしの両方で走らせ、`run.json` からその区別がつく** | **部分的。**実際に 2 回走らせて `run.json` を書き出し、全件 `recorded` と全件 `not_requested` に分かれることを確認した。**ただし Fake アダプタ上であり、実機ではない** |

**残っている理由**: 実機で走らせるには adb + scrcpy と端末が要る（Issue 001 / 004 / 005）。手元に無いので**勝手に調達しない**。Fake で確かめられたのは「録画の有無が証跡に出る配線が繋がっていること」までで、「実機の画面が本当に録れること」ではない。

**この Issue は close しない。**実機で 1 回走らせて `screen.mp4` が実在した時点で閉じる。
