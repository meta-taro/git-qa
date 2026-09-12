# Windows のデスクトップ検証（試験導入・引き継ぎ）

> **この文書は、Windows 機で動かす人／エージェント向けです。**
> 書いた側（macOS）は **Windows 機を持っていません。**
> 型検査と CI での建てまでは通っていますが、**1 度も走らせていません。**

---

## 役割の分け方

| | 誰が |
|---|---|
| 設計・Rust と TypeScript を書く・検査・CI で建てる | **macOS 側** |
| **実物のアプリに当てて、何が起きたかを返す** | **Windows 側（あなた）** |

**同じものを 2 人で書かないでください。**割れます。

そこで、**ファイルの持ち主を分けます。**

| 場所 | 持ち主 |
|---|---|
| `packages/adapter-desktop/tools/win/`（Rust） | **Windows 側** |
| `packages/adapter-desktop/src/win/`（TypeScript） | **Windows 側** |
| それ以外全部（core / 実行器 / 画面 / macOS 側） | **macOS 側** |

**この 2 つのフォルダの中は、自由に直してください。**当てて見ないと分からない所
（`PrintWindow` のフラグ・高 DPI・UI Automation の癖）は、**そこに閉じています。**

**境界を越えるときは、先に Issue で一言。**

- `@git-qa/core` の型を変えたい（`AdapterCapabilities` に何か足したい等）
- 共通の実行器（`packages/core/src/run/`）や画面（`packages/desktop/src/`）を直したい
- macOS 側（`packages/adapter-desktop/src/*.ts` の `win/` 以外）を直したい

**そこが割れ始めの入口**なので、そちらは macOS 側でやります。

**共有しているファイルが 1 つも無い**のは、最初からそう作ってあるからです
（上から見た口は macOS と同じ `TargetSession`）。**その形は崩さないでください。**

### 触らないでほしいもの

`CHANGELOG.md` と `.claude/project-status.md` は、**macOS 側がまとめて書きます。**
両方から書くと、ここだけ毎回ぶつかります。**何が起きたかは Issue に書いてください。**

**この分け方は、一度うまくいっています。**別プロダクトの試験導入で、
使った人が実物を触って 3 件の指摘をくれました（#1 / #2 / #3）。3 件とも本物でした。

---

## 何が出来ていて、何が無いか

| | macOS | Windows |
|---|---|---|
| 窓を探す | `CGWindowListCopyWindowInfo` | `EnumWindows` |
| 窓を撮る | `screencapture -l` | **`PrintWindow`**（`PW_RENDERFULLCONTENT`） |
| 文字を読む | AX（段 1）＋ Vision OCR（段 2） | **UI Automation だけ** |
| 押す | `AXPress` | **UI Automation の `Invoke`** |
| なぞる・文字を打つ・回す | あり | **無い**（`textInput: 'none'` と名乗っている） |
| 録る | ScreenCaptureKit | **無い**（`unsupported`。画面は残る） |
| 相手の入れ替わり検出 | `lsof -d txt` | `QueryFullProcessImageNameW` |

**無いものは「無い」と名乗らせてあります。**文字を打つ手順は、
planning の段で「**人が入力する**」に倒れます（黙って失敗しません）。

---

## 動かす

```powershell
git clone https://github.com/meta-taro/git-qa.git
cd git-qa
pnpm install
pnpm app
```

**Node 22 以上が要ります。**

設定画面の「**デスクトップアプリを見るなら、アプリ名**」に、
**実行ファイルの名前か、窓の題の一部**を入れてください（`dbboard` など）。
大文字小文字は見ていません。

---

## 道具を単体で叩く（切り分け用）

画面を通さずに、道具だけを試せます。**これがいちばん速い切り分けです。**

```powershell
cd packages\adapter-desktop\tools\win
cargo build --release
$t = "target\release\git-qa-win.exe"

& $t windows dbboard        # 窓を探す: hwnd pid exe 題 x y w h
& $t shot <hwnd> a.png      # その窓だけを撮る（w h を返す）
& $t text <hwnd>            # 読める文字: name x y w h
& $t press <hwnd> <x> <y>   # 画面の座標で押す
& $t exe <pid>              # 実行ファイルの場所
```

---

## 報告してほしいこと

**要約しないでください。**出た文言をそのまま貼ってください。

### 1. 窓が見つかるか

```powershell
& $t windows <アプリ名>
```

- **何も出ない** → 何を打ったか、実際の窓の題は何か
- **余計な窓まで出る** → どれが要らなかったか

### 2. 撮れるか（**いちばん怪しい所**）

```powershell
& $t shot <hwnd> a.png
```

`a.png` を開いて見てください。

- **真っ白／真っ黒** → `PW_RENDERFULLCONTENT` が効いていません。
  **相手は Electron ですか？ WPF ですか？ WinForms ですか？**それが分かれば直せます
- **前に重なっている窓が写る** → `PrintWindow` が効かず、画面を撮っている可能性

### 3. 文字が読めるか（**次に怪しい所**）

```powershell
& $t text <hwnd>
```

macOS では、Electron 相手に段 1 が `group` しか返さず、**OCR を足す羽目になりました。**
Windows の UI Automation は Chromium が中身を出してくれる見込みですが、**未確認です。**

- **1 行も出ない** → 相手は何で作られていますか
- **座標がずれている** → 高 DPI（拡大表示）の設定を教えてください。
  **いまは DPI を見ていません。**ここは落ちると思っています

### 4. 押せるか

```powershell
& $t press <hwnd> <x> <y>
```

- **「そこは押せる作りになっていない」** → その要素は何ですか（ボタン？ div？）
- **押したのに何も起きない** → `Invoke` が受け取られていない可能性

---

## 分かっている穴（先に言っておきます）

- **高 DPI を見ていません。**拡大表示 125% / 150% の機械では、座標がずれるはずです
- **窓が複数あると、最初の 1 つを使います。**選べません
- **なぞる・文字を打つ・回すが無い**ので、それが要る検証はまだできません
- **録画が無い**ので、証跡は画面（`screen.webp`）だけです

**これらは「まだ作っていない」であって、「作れない」ではありません。**
どれが先に要るかを教えてください。**要ると分かったものから足します。**

---

## 直すときの決めごと

- **テストを後回しにしない**（`pnpm verify` が通る状態を保つ）
- **commit は AI、push は人**
- **公開リポジトリです。**個人名・個人メールアドレスを残さない
- 詳しくは `.claude/rules/product-baseline.md`
