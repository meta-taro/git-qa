# Windows のデスクトップ検証（試験導入・引き継ぎ）

> **この文書は、Windows 機で動かす人／エージェント向けです。**
> 書いた側（macOS）は **Windows 機を持っていません。**
>
> **2026-09-12〜14、Windows 機で初めて走らせました。**`pnpm verify` が通り、`pnpm app` の
> 窓が出て、**検証シート 1 本を一本道で通し、証跡（`run.json`）まで出ています。**
> **そのとき実機で 10 件の不具合・穴が出て、8 件を直しました**（下に実測値を残してあります）。
> **確かめた機械は 1 台・表示倍率 100%** です。高 DPI はまだ誰も踏んでいません。

**一本道の実測**（2026-09-14・相手はメモ帳）

```
[git-qa] 見るアプリ: notepad（段 1 のみ）
[git-qa] 証跡: runs\20260914-163146\run.json
[git-qa] 1 件中 0 件を人が見て置いた

  aiResult / result  BLOCKED（「この手順を操作へ落とせない: アプリの窓を探す」）
  verifiedBy         なし              ← 人が押していないので付かない
  recording          unsupported       ← Windows の録画はまだ無い（理由が証跡に残る）
  screenshot         case-001/screen.png
  targetCheck        same              ← 相手の入れ替わり検出が Windows でも効く
```

**`.webp` ではなく `.png` で残ります。**`cwebp` が無い機械では変換せず、撮れた形のまま
置きます（**名前と中身は必ず一致させる**）。

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

**要るもの**（2026-09-12・実際に入れて確かめた組み合わせ）

| | 確かめた版 | 何に要るか |
|---|---|---|
| Node | 24.19.0（**22 以上**） | 実行器 |
| pnpm | 11.1.1（`packageManager` と一致させる） | 全部 |
| **Rust（MSVC）** | 1.98.1 | `git-qa-win.exe` と Tauri。**無いと `pnpm build` が落ちます** |
| **VS 2022 Build Tools（C++ ワークロード＋Windows SDK）** | 17.14 | 上の Rust が使うリンカ |
| WebView2 Runtime | 152.0.4191.66 | 画面（Windows 11 には既定で入っています） |

```powershell
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override `
  "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

**`pnpm verify` は、どの殻から走らせても同じ結果になります**（2026-09-12 に直しました）。
それまでは PowerShell から走らせると `bash` が WSL に解決されて落ち、Git Bash からは
通る、という状態でした。**同じ commit が、開いている窓によって通ったり落ちたりします。**

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

**Windows も同じ所で詰まりました**（2026-09-12・実機で確認）。見込み（「Chromium が
中身を出してくれる」）は**外れです。**Chromium は**支援技術が居ると分かるまで、
描画側のアクセシビリティを起こしません。**

| | 読めた行数 | ページ本文 |
|---|---|---|
| そのまま読む | 20 行 | **1 行も出ない** |
| `--force-renderer-accessibility` 付きで起動 | 131 行 | 出る |
| **道具の側から起こす**（いまの実装） | 135 行 | 出る |

**起動フラグは解決にしませんでした。**検証の相手は顧客のアプリで、こちらから
付け直して起動できるとは限りません（Electron も同じ）。描画の子窓
（`Chrome_RenderWidgetHostHWND`）へ `WM_GETOBJECT` を送って起こします
（`tools/win/src/wake.rs`）。**画面読み上げソフトと同じやり方で、相手は前面に出ません。**

**段 2（OCR）は足さずに済みました。**

- **1 行も出ない** → 相手は何で作られていますか
- **座標がずれている** → 高 DPI（拡大表示）の設定を教えてください。
  **いまは DPI を見ていません。**ここは落ちると思っています
  （確認したのは**表示倍率 100%（96 DPI）の機械 1 台だけ**です）

### 4. 押せるか

```powershell
& $t press <hwnd> <x> <y>
```

- **「そこは押せる作りになっていない」** → その要素は何ですか（ボタン？ div？）
- **押したのに何も起きない** → `Invoke` が受け取られていない可能性

---

## 分かっている穴（先に言っておきます）

- **高 DPI を見ていません。**拡大表示 125% / 150% の機械では、座標がずれるはずです。
  **ここはまだ誰も踏んでいません**（確認した機械は 100%）
- **なぞる・文字を打つ・回すが無い**ので、それが要る検証はまだできません
- **録画が無い**ので、証跡は画面（`screen.png`）だけです
- **ネイティブの編集領域の本文が読めません**（2026-09-14・メモ帳で実測）。
  UI Automation の `Name` だけを読んでいるので、**入力欄の中身は出てきません**
  （テキスト エディターという名前の器だけが出ます）。Chromium の中身は読めます。
  **入力欄の値を確かめる検証は、いまはできません。**`ValuePattern` / `TextPattern` を
  足せば読めるはずですが、**要ると分かってから足します**
- **押すのは `Invoke` を持つ要素だけ**です。独自描画のボタンや、`Invoke` を持たない
  要素は「そこは押せる作りになっていない」と断ります。**見えていない要素にも届きます**
  （画面外のリンクを押せた）が、**人には何が押されたか見えません**

**塞いだもの**（2026-09-12・実機で出たので直しました）

- ~~窓が複数あると、最初の 1 つを使います~~ → **実行ファイル名で当たったものを優先し、
  その中でいちばん大きい窓を採ります**（`src/win/tool.ts` の `pickWindow`）。
  実測では、`sshboard` を探すと**題にパスが入った explorer** と
  **16x16 の道具窓**が先に並んでいました
- ~~最小化された窓が一覧に出る~~ → `IsIconic` で落とします。
  `IsWindowVisible` は最小化でも `TRUE` を返し、大きさは `-32000,-32000 / 199x34` になります
- ~~本体が最小化されていると、16x16 の道具窓を黙って相手にする~~ →
  **「人が見ている窓ではない」と断ります**（`whyUnusable`）

**これらは「まだ作っていない」であって、「作れない」ではありません。**
どれが先に要るかを教えてください。**要ると分かったものから足します。**

---

## 直すときの決めごと

- **テストを後回しにしない**（`pnpm verify` が通る状態を保つ）
- **commit は AI、push は人**
- **公開リポジトリです。**個人名・個人メールアドレスを残さない
- 詳しくは `.claude/rules/product-baseline.md`
