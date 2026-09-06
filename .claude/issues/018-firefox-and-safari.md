# 018 — Firefox / Safari で見られるようにする

- Phase: 2
- 前提: 015（ウェブ検証）が試験運用に入っていること
- 優先度: **配ってから決める**

## なぜ

**人の言葉**（2026-09-06）:

> firefox セキュリティソフトがだすブラウザ、brave とか
>
> 興味はないけど、AI ドリブンで、ここら対応していた方が、宣伝になるかなーと。

**「Chromium 系だけ」と「Firefox も」では、聞こえ方が違う。**

## いま対応しているもの（2026-09-06 時点）

| | 手 |
|---|---|
| Chrome / Edge / Brave / Chromium | **名前で選べる** |
| **セキュリティソフト付属のブラウザ** | **「その他」で実行ファイルの場所を指定。**中身が Chromium なら動く |

**名前を数え上げに行かない。**セキュリティソフトが出すブラウザは数えきれないし、増える。

## 足りていないもの

| | 中身 | 何が違うか |
|---|---|---|
| **Firefox** | Gecko | CDP は廃止方向。**WebDriver BiDi** が本命 |
| **Safari** | WebKit | CDP が無い。`safaridriver`（WebDriver）で別の口 |

## Firefox の見立て（**依存はまた足さずに済む**）

- **繋ぎ方**: `--remote-debugging-port` で BiDi の WebSocket が開く。
  Node の `WebSocket` でそのまま繋がる（C54 と同じ）
- **命令**: `browsingContext.navigate` / `input.performActions` / `script.evaluate`
- **映像**: BiDi に screencast は無い。**`browsingContext.captureScreenshot` を回す**
  —— デスクトップアダプタで既にやっている形（`image-frames`・約 8 fps）
- **分量**: `cdp.ts` に当たるものをもう 1 本（**300〜400 行**）＋ アダプタ

**半日仕事。**新しい依存は要らない見込み。

## Safari の見立て

`safaridriver --enable` を人が 1 回打つ必要がある（**人の作業**）。
WebDriver は BiDi とも CDP とも違うので、**3 本目のプロトコル**になる。
ただし **iOS Safari の代理**になるので、Issue 001（iOS）が止まっている間の価値は高い。

## 実測（2026-09-06・このマシン）

**このマシンの Firefox は 89.0.2（2021 年）。**起こして何が開くか見た。

```
/json/version → { "Browser": "Firefox/89.0.2", "Protocol-Version": "1.0" }
ログ          → DevTools listening on ws://localhost:9333/devtools/browser/…
/session      → 404 Not Found
```

**この版は CDP を話す。BiDi は無い。**

**ただしそこに乗ってはいけない。**Firefox は **129 で CDP を捨てている**。
古い Firefox でだけ動くものを「Firefox 対応」と書くと、
**新しい Firefox を使っている人の所で動かない。**それは、はったりになる。

→ **BiDi 一本で作る。**そのために**新しい Firefox が要る**（人が入れる）。

## 決める順番

**配って、試験運用のフィードバックを見てから。**
人がここで書いた通り、実務で確かめたほうが実のあるものが出る。

## 作業ログ

### 2026-09-06 — **道は全部書けた。新しい Firefox が要るだけ**

`packages/adapter-web` に足したもの。

| | |
|---|---|
| `bidi.ts` | BiDi のやりとり（**返事に `type` が付く**のが CDP との違い） |
| `firefox.ts` | 起こし方・繋ぎ先の読み取り・触り方（**判断のある所。ブラウザ無しで検査済み**） |
| `firefox-adapter.ts` | 見る・触る・読む（`image-frames` に乗せる） |

**BiDi に screencast は無い**ので、絵は撮り続けて流す（`browsingContext.captureScreenshot`）。
**デスクトップアダプタで作った道をそのまま使えた。**

**依存は 1 つも足していない。**

### 実物で当てた結果（このマシンの Firefox 89.0.2）

```
止まった理由: Firefox は起きたが、BiDi の繋ぎ先を言ってこない（12000 ms 待った）。
古い Firefox は BiDi を持っていない（129 より前は CDP のみ）。新しい Firefox を入れる。
言ったこと: DevTools listening on ws://localhost:50028/devtools/browser/…
```

**意図どおり。**古い Firefox が出した CDP の 1 行を**掴まなかった**のも正しい
（掴むと、繋いだ先で命令が全部断られて原因が分からなくなる）。

### 2026-09-06（続き）— **Firefox 155 で通った**

人が Firefox を入れた（**155.0.1**）。その場で通した。

```
target: { "kind": "web", "browser": "Mozilla Firefox（Firefox/155.0）", ... }

1 AUTO_PASS | PASS | 画面の文字に「ローカルで動いているページ」が在ることだけを見た
2 AUTO_PASS | PASS | 画面の文字に「まだ押されていない」が在ることだけを見た
3 AUTO_PASS | PASS | 画面の文字に「押された」が在ることだけを見た
```

**3 件目はクリックを含む。**文字で要素を探して押し、その結果を読んでいる。

### 途中で 1 つ踏んだ（実測でしか出ない）

**DOM が 0 文字で返ってきた。**

**BiDi は値を型つきで返す。**CDP は `returnByValue` で素の値をくれるが、
BiDi のオブジェクトは**組の並び**になる。

```
document.title → {"type":"string","value":"Example Domain"}
({a:1})        → {"type":"object","value":[["a",{"type":"number","value":1}]]}
```

`fromRemoteValue` を足して戻すようにした。**知らない型は undefined**にする
（中途半端に読むと、読めたことになってしまう）。

### 2026-09-06（続き）— **Safari の道も書けた。許可 1 つで止まっている**

`safaridriver` は OS 付属（`/System/Cryptexes/App/usr/bin/safaridriver`）。
**WebDriver は HTTP**（CDP も BiDi も WebSocket だったので、3 本目は形が違う）。
**依存はまた足していない。**

実物に当てた結果:

```
止まった理由: Safari を外から動かす許可が入っていない。
Safari の設定 →「詳細」→「Web デベロッパ用の機能を表示」を入れ、
「開発」メニュー →「リモートオートメーションを許可」にチェックを入れる
（元の理由: Could not create a session: You must enable 'Allow remote automation' …）
```

**Safari が英語で返した文を、人が動ける日本語に直して返している。**元の文も残してある。

### 残っていること

- **Safari の「リモートオートメーションを許可」にチェックを入れる**（**人の作業**）。
  入れば、その場で通して実測に変える
- 対応表の Safari を動かすのは、**通ってから**（C56）

