# 010 — 既存 OSS の実地調査と「作らない」判定

- Phase: 0
- 前提: なし

## 目的

原案の 4 原則の 1 つが「Existing OSS First」（初期の企画草案 §3）。**これを徹底すると「既存の組み合わせで足りる」という結論があり得る。**

**その判定を最初にする。**作った後に気づくと、時間がまるごと無駄になる。

## 決めること（このリポで決めてよい・企画側へ選択肢を投げ返さない）

- 調査対象（下記は出発点。足してよい）
- 「足りている / 足りていない」の判定基準

## 調査対象（出発点）

| 製品 | 見る点 |
|---|---|
| Maestro Studio | ライブで見ながら操作できるか。人の判定を残せるか |
| Appium Inspector | 同上 |
| Allure / ReportPortal | 証跡と人の判定の分離。`VERIFIED` 相当があるか |
| Playwright Trace Viewer | 実行後の証跡としてどこまで足りるか |
| scrcpy 単体 + 手動記録 | **これで足りてしまわないか**（最も安い代替） |

## 判定の観点

この製品が主張する価値は 3 つ。**既存品がこの 3 つを満たすなら、作る理由がない。**

1. **人が横でライブで見ながら、1 打鍵で合否を置ける**
2. **`VERIFIED`（人が見た）と `AUTO_PASS`（AI が通しただけ）が別の値として残る**
3. **手作業より明確に速い**

## 作業内容

1. **触れるものは実際に触る。**紹介記事だけで判定しない
2. 3 つの観点それぞれについて、満たす / 満たさないを書く
3. 満たさない場合、**それが設計思想の違いなのか、単に機能が無いだけなのか**を書く（後者なら、その製品への貢献で済む可能性がある）
4. 最後に判定を書く

## 完了条件

- 5 製品以上について、**実際に触った結果**が書かれている（触れなかったものは、触れなかったと書く）
- 3 つの観点それぞれについて表になっている
- 判定が 3 つのいずれかで書かれている
  - **作る** — 既存品では埋まらない。理由が具体的
  - **作らない** — 既存の組み合わせで足りる。その組み合わせが書かれている
  - **既存へ貢献する** — 1 つの製品に機能を足せば足りる。どの製品のどこか

## 注意

- **「独自性があるから作る」を理由にしない**（初期の企画草案 §19 も同じことを書いている）。作る理由は「本人の手間が減らないから」であるべき
- **作らない、という結論を歓迎する。**それが出たらこの Issue の成果

## 作業ログ

### 2026-09-02 — 5 製品のうち 2 つを実際に触った（途中）

**触った 2 つ**

#### Playwright Trace Viewer（`@playwright/test` 1.62.1）

使い捨てのプロジェクトを作り、3 ケース（うち 1 件はわざと落とす）を `trace: 'on'` /
`video: 'on'` / `screenshot: 'on'` で実行した。落ちたケースの trace.zip・動画・
スクリーンショット・HTML レポートが実際に出る。**証跡としては十分に厚い。**

**結果の語彙（型の実物）**

```
TestStatus = 'passed' | 'failed' | 'timedout' | 'interrupted'
outcome    = 'skipped' | 'expected' | 'unexpected' | 'flaky'
```

結果 1 件が持つキー: `annotations` `attachments` `duration` `errors` `parallelIndex`
`retry` `startTime` `status` `stderr` `stdout` `workerIndex`

**誰が見たかを持つ項目が無い。**`playwright test --help` に verify / human / approve /
sign / manual に類するオプションは無く、reporter の型にも該当する項目が無い。

#### scrcpy 4.1

Android エミュレータ（Pixel 3a / API 31）に対して `--record` で 60 秒録画した。
**ライブで見ることについては、この製品が既に前提として採用している**（C4 / PRD §2）。

- 実測: 5.05 MB（実時間 60 秒ぶん）/ 1080x2220 / 平均 10 fps
- **画面が変化したときしかフレームを作らない。**スクロールを止めると映像も止まる

#### Allure Report 2.46.0（`allure-playwright` 3.11.0）

同じ 3 ケースを Allure のレポータ付きで走らせ、`allure-results/*.json` を読んだ。

結果 1 件のキー: `attachments` `fullName` `historyId` `labels` `links` `name` `parameters`
`stage` `start` `status` `statusDetails` `steps` `stop` `testCaseId` `titlePath` `uuid`

**人の判定を持つ項目が無い。**`labels` は自由な key/value なので「誰が見たか」を**書ける**が、
それはメタデータであって結果の値ではない。集計もレポートの合否も `status` を見る。

**注: 触ったのは OSS の Allure Report。**手動テストと人の判定を持つのは商用の Allure TestOps 側で、
**そちらは触っていない。**

#### Maestro 2.10.0

エミュレータに対してフローを 2 本（通る / 落ちる）実行した。JUnit 出力の実物:

```xml
<testcase id="pass" ... status="SUCCESS"/>
<testcase id="fail" ... status="ERROR"><failure>Assertion is false: ...</failure></testcase>
```

**`SUCCESS` / `ERROR` の 2 値。人の判定は無い。**

**調査対象リストが古くなっていた。**`maestro studio` は CLI から消えている。

> Maestro Studio is no longer bundled with the CLI.
> Download the new Maestro Studio desktop app instead:

**Studio は独立したデスクトップアプリになった。**GUI なので画面が要る。**今回は触れていない。**

##### 重要 — Maestro は MCP サーバを持っている

`maestro mcp` が **10 個の道具**を MCP で出す（実際に叩いて一覧を取った）。

| 道具 | 内容 |
|---|---|
| `list_devices` | 起動できる端末の一覧 |
| `take_screenshot` | 画面の撮影 |
| `run` | Maestro のコマンドを直接流して端末を操作 |
| `inspect_screen` | 画面の階層を JSON で取得 |
| `cheat_sheet` | コマンドの早見表 |
| `open_maestro_viewer` | ビューアの URL を返す |
| `list_cloud_devices` / `run_on_cloud` / `get_cloud_run_status` / `describe_cloud_run` | Maestro Cloud 側 |

**これは git-qa が Phase 4 で計画している `device.*` とほぼ重なる。**
**そして `human.*` に当たるものが 1 つも無い。**

#### Appium 3.7.0（部分的にしか触れていない）

サーバは入って起動する。**driver（uiautomator2）の導入に失敗した** — Appium は内部で npm を
呼ぶが、pnpm 管理下のディレクトリで `Cannot read properties of null (reading 'matches')` で落ちる。
**そのためエミュレータへセッションを張るところまで行っていない。**

**Appium Inspector（調査対象）はデスクトップの GUI アプリ**で、画面が要る。**触れていない。**

構造としては、**Appium は WebDriver のサーバであってテスト結果の概念を持たない**（結果は
それを叩くランナー側にある）ので、観点 2 はそもそも Appium 単体には当てはまらない。

#### ReportPortal — 触れなかった

**Docker が必要だが、デーモンが動いていない**（Docker Desktop の起動は GUI 操作で、
画面がロックされていて実行できなかった）。**未検証。**

### 3 つの観点

空欄は**触れていないので書かない**（推測で埋めない）。

| | Playwright Trace Viewer | scrcpy 単体 + 手動記録 | Maestro CLI | Maestro Studio (app) | Appium Inspector | Allure Report | ReportPortal |
|---|---|---|---|---|---|---|---|
| 1. ライブで見ながら 1 打鍵で合否 | **満たさない** | **半分**（見るのは満たす。合否を置く口が無い） | **満たさない**（無人実行が前提） | | | **満たさない**（実行後のレポート） | |
| 2. `VERIFIED` と `AUTO_PASS` が別の値 | **満たさない** | **満たさない**（結果の概念が無い） | **満たさない**（`SUCCESS` / `ERROR`） | | | **満たさない**（`labels` に書けるがメタデータ） | |
| 3. 手作業より明確に速い | **比較対象が違う** | **満たさない**（人が別途シートに書くので手作業のまま） | **比較対象が違う** | | | **該当しない** | |

### 満たさない理由は「思想の違い」か「機能が無いだけ」か

- **Playwright Trace Viewer — 思想の違い。**自動テストランナーであり、**誰も見ていないことが前提**。
  `status` は固定の列挙で、人の判定を入れる場所は `annotations`（自由記述）しか無い。
  そこへ書いてもレポートや CI が読む値にはならない。**「人が見た」を一級の値にするには、
  結果の語彙そのものを変えることになる**ので、この製品への機能追加では収まらない
- **scrcpy — 機能が無いだけ、ですらない。**ミラーリングと録画の道具であって、判定の概念を持たない。
  **持たないのが正しい**（この製品も scrcpy を置き換えない・非目標に明記）。
  組み合わせて使う相手であって、比較の対象ではない
- **Allure Report — 守備範囲の違い。**実行後のレポート層であって、実行中の人の関与を扱わない。
  `labels` という自由な入れ物はあるので「書ける」が、**結果の値にはならない**（合否は `status` を見る）。
  **人の判定を一級に扱うのは商用の Allure TestOps 側で、そこは触っていない**
- **Maestro CLI — 思想の違い。**`SUCCESS` / `ERROR` の 2 値で、**無人で流すことが前提**。
  ただし**端末を操作する部分は MCP として既に出ている**（下記）
- **Appium — 層が違う。**WebDriver のサーバで、結果という概念を持たない。比較の対象ではなく、
  Adapter の実装候補

## 結果

（**現時点では未完了。**判定は書かない。理由は下記）

### 触った範囲で言えること

**触った 5 つ（Playwright / scrcpy / Maestro CLI / Allure Report / Appium 部分的）のいずれも、
観点 2（`VERIFIED` と `AUTO_PASS` を別の値として残す）を満たさない。**
結果の語彙はどれも「通った / 落ちた」で、**誰が見たかを持つ項目が無い**。

これは機能の欠落というより**思想の違い**で、いずれも**無人で流すことを前提に作られている**。

### なぜ判定を書かないか

**3 つが未検証で、そのうち 2 つは「人の判定」を持つ可能性が残っている。**

- **ReportPortal** — Docker が動かず未検証。**欠陥の分類や「要調査 / 調査済み」といった、
  人が結果へ手を入れる仕組みを持つ**とされる層なので、ここが埋まるなら判定が変わりうる
- **Allure TestOps（商用）** — 手動テストと人の判定を持つ側。OSS の Report しか触っていない
- **Maestro Studio（デスクトップアプリ）/ Appium Inspector** — どちらも GUI で、
  **画面がロックされていて起動できなかった**

**先に「作る」と書かない。**未検証の 3 つを潰してから書く。

### 判定とは別に出た、ロードマップに関わる発見（提案）

**`maestro mcp` が `list_devices` / `take_screenshot` / `run` / `inspect_screen` /
`open_maestro_viewer` を MCP で出している。**これは `.claude/roadmap.md` の Phase 4 で
git-qa が自分で出そうとしている **`device.*` とほぼ同じ**。

**提案: Phase 4 の `device.*` を自作せず、Maestro の MCP に寄せることを検討する。**

- git-qa が主張する価値は `human.*`（人が見た、という値を残すこと）に集中している。
  **Maestro の MCP にはそこが無い**
- 端末を操作する部分を自作すると、**非目標に挙げた「Maestro の再実装」に近づく**

**これは提案であって、決定の変更ではない**（product-baseline §15）。
`roadmap.md` の Phase 4 と C8 に関わるので、人の判断を仰ぐ。
**未検証の 3 つを潰してから、判定と一緒に出すのが順当。**

### 2026-09-03 — 判定を書いた

**触れなかった 3 つは、ソースと文書で答えを取った。**Docker が動かず（GUI 起動が要る）、
Maestro Studio と Appium Inspector はこの Mac に入っていない。
**ただしこの Issue の問いは「どんなデータ構造を持つか」なので、動かさなくても答えが出る。**
画面を触らないと分からないのは観点 1（触り心地）だけで、そこは触れたものだけで判断した。

#### 観点ごとの表

| 製品 | 1. ライブで見ながら 1 打鍵で置けるか | 2. `VERIFIED` と `AUTO_PASS` が別の値か | 3. 手作業より速いか |
|---|---|---|---|
| Playwright（触った） | ✗ 実行後の証跡が主。人が置く口が無い | ✗ `passed \| failed \| timedout \| interrupted` | 自動化できる範囲では速い |
| Maestro CLI（触った） | ✗ 実行と結果出力のみ | ✗ `SUCCESS` / `ERROR` | 同上 |
| Allure Report OSS（触った） | ✗ 見るだけ | ✗ `status` ＋ 自由な `labels`（メタデータであって結果の値ではない） | — |
| scrcpy（触った） | **△ 見ながら触れる**（この製品の中央カラムと同じ体験） | ✗ 結果という概念を持たない | 記録は人が別に書く |
| Appium（部分的に触った） | ✗ サーバなので結果の概念が無い | ✗ 同上 | — |
| **ReportPortal**（ソースで確認） | ✗ 実行後の解析が主 | **△ 失敗の分類にだけ「自動か人か」がある** | — |
| **Allure TestOps 商用**（文書で確認） | △ 手動実行の画面はある | ✗ `Passed / Failed / Skipped / Broken / Unknown`。**手動でも自動でも同じ値** | — |

#### ReportPortal だけが、この軸を部分的に持っていた

`IssueEntity` に **`auto_analyzed`（真偽値）**がある。**自動解析が付けた分類なのか、人が付けたのか**を
区別している。**この軸が実在することの裏付け**になる。

```java
@Column(name = "auto_analyzed")
private boolean autoAnalyzed;
```

**ただし持っているのは「失敗の分類」についてだけ。**結果そのものの語彙は
`IN_PROGRESS / PASSED / FAILED / STOPPED / SKIPPED / INTERRUPTED / CANCELLED / INFO / WARN` で、
**`PASSED` に「人が見た」印は無い。**つまり
**「誰も見ていない PASS」と「人が見た PASS」が同じ値**になる。

Allure TestOps は手動実行の画面を持つが、**結果の値は自動と同じ**
（`Passed / Failed / Skipped / Broken / Unknown`）。文書上、
**その結果を人が置いたことを示す欄は無い。**

## 判定

**作る。**ただし**自作するのは「結果の語彙」だけ**にする。

**理由（「独自性があるから」ではない）**

- **人が見た PASS と、誰も見ていない PASS が、どの製品でも同じ値になる。**
  この 2 つを混ぜると、**証跡を読んだ人が「誰が保証したか」を復元できない。**
  リリース判断の材料としてはそこが要点なので、混ざったままでは本人の手間が減らない
- **ReportPortal が「自動か人か」を失敗側で持っている**ことは、この軸が実務で要ることの裏付け。
  ただし**成功側には無い**ので、そのまま使うと目的を果たせない

**自作しないもの（既存に寄せる）**

| | 使うもの |
|---|---|
| 端末の操作・画面の取得 | `adb`（`screenrecord` / `uiautomator` / `input`）。将来は scrcpy のサーバも候補 |
| 見ながら触る体験 | scrcpy が示した形をそのまま採る（枠の中に映して触る） |
| 証跡の見せ方 | Allure / ReportPortal へ寄せられる可能性がある（`run.json` からの変換）。**いま作らない** |

**「既存へ貢献する」を採らなかった理由**

ReportPortal に「人が見た PASS」を足すのは、**結果の語彙そのものを変える提案**になる。
外部の製品の中核データ構造を変える提案は、通る見込みが薄く、通っても時間の見通しが立たない。
**こちらの語彙を持ったまま、証跡の出力側で寄せるほうが現実的。**

#### この判定を覆すべき条件

- **どこかの製品が「人が見た」を結果の値として持ったら。**そのときは、こちらの語彙を捨てて寄せる
- **主指標（手作業との所要時間比較・C7）で、手作業に負けたら。**速くならないなら、
  語彙が正しくても作る理由が無い
