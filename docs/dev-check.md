# OS ごとの開発動作確認

> **この文書は、各々の OS で git-qa を開発する人／エージェント向けです**（2026-09-19）。
>
> **書いた側は macOS です。**Windows 機も iPhone も、常に手元にあるわけではありません。
> **「自分の機械では動いた」は、そのままでは他の人に渡せません。**

## まず 1 つだけ流してください

```bash
pnpm doctor
```

**その出力をそのまま貼ってください。**整えないでください。

```
git-qa の環境確認 — darwin arm64 / dev

## 見る
✓ Node — v22.23.2
✓ adb（Android） — 入っている（端末は 0 台）
✓ ブラウザ — Google Chrome
✓ Firefox / Safari — Firefox / Included with Safari 26.6.1
✓ iPhone — 実機はつながっていない（アダプタもまだ無い）
…
```

- `✓` は**実際に呼んで返ってきた**もの。**見込みは書いていません**（C56）
- `–` は**その OS では要らない**もの（macOS の `git-qa-win` など）。欠けている数に入りません
- `✗` と `!` が、**その機械で足りていないもの**です

## いま何が実測済みか（2026-09-19）

**「動く見込み」と「動いた」を混ぜません。**空欄は**誰もまだ踏んでいない**という意味です。

| | macOS | Windows | Linux |
|---|---|---|---|
| デスクトップアプリ | ✅ 実測 | ✅ 実測（録画は無い） | |
| ウェブ（Chrome / Firefox / Safari） | ✅ 実測 | | |
| Android 実機 | ✅ 実測 | | |
| iPhone 実機 | ❌ **アダプタが無い** | ❌ **アダプタが無い** | ❌ **アダプタが無い** |
| 録画 | ✅ 実測 | ❌ 無い | ❌ 無い |

**空欄を埋めるのが、この文書の目的です。**

## 開発版の受け取り方（Windows）

`develop` に入るたびに CI が建てて、**転がる `dev` という版**に置いています。

https://github.com/meta-taro/git-qa/releases/tag/dev

- **Windows だけ**置いています。**mac 側は手元から動かしてください**（`pnpm app`）
  署名と公証の無い `.dmg` は macOS で「壊れているため開けません」になるためです
- **署名していません。**「WindowsによってPCが保護されました」が出ます
- 名乗りは **`dev-<短い sha>`** です。**「新しい版が出ています」は出ません**（急かしません）

**配った版**（試験導入の方へ渡すもの）は `v0.2.0-beta.*` のほうです。混ぜないでください。

## 何を流して、何を貼るか

### どの OS でも

```bash
pnpm install --frozen-lockfile
pnpm verify        # format / lint / typecheck / test / build
pnpm doctor        # この機械で何ができるか
```

**`pnpm verify` が落ちたら、そこで止めて落ちた出力を貼ってください。**
手元のゲートが壊れているのか、そちらの機械でだけ落ちるのかが、こちらからは見えません。

### デスクトップアプリを見る

```bash
pnpm app                                   # 画面から始める
pnpm run:sheet:desktop <シート> "<アプリ名>"  # 端から端まで
```

**貼るもの**: `runs/<runId>/run.json` の頭（`target` と `runner`）と、`[git-qa]` で始まる行。

### ウェブを見る

```bash
pnpm run:sheet:web sheets/web-sample-ja.tsv --no-ui
```

**Windows ではまだ誰も流していません。**踏んだものを、そのまま挙げてください。

### Android を見る

```bash
adb devices
pnpm run:sheet sheets/android-settings-ja.tsv
```

**Windows + Android はまだ誰も流していません。**

### iPhone を見る

**まだできません。**アダプタが無く、「未テスト」ではなく「無い」です。

`pnpm doctor` は**挿したことには気づきます**（macOS のみ・`xcrun devicectl`）。
そこから先は `.claude/issues/001` で、**問いは「操作できるか」ではなく
「実用的な遅延で見られるか」**です。**見られないなら iOS は AUTO 専用になり、製品が別物になります。**

## 踏んだら、どこへ書くか

**GitHub の Issue へ、使った直後にご自身の言葉で書いてください**（baseline §27）。
**こちらで要約しません。**要約した時点で、本当に困っていた所が落ちます。

- **`pnpm doctor` の出力**（どの機械の話かが決まります）
- **踏んだ操作**と、**画面に出た文言の全文**
- **証跡**（`runs/<runId>/run.json`）があれば、その `target` と `runner`

**`runner` に版が入っています**（C70）。**どの版で踏んだかが、ここで決まります。**
