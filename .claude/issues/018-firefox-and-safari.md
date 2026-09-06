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

## 決める順番

**配って、試験運用のフィードバックを見てから。**
人がここで書いた通り、実務で確かめたほうが実のあるものが出る。

## 作業ログ

（着手時に追記）
