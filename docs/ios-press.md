# iPhone / iPad を押す（WebDriverAgent を起こす）

git-qa は iPhone / iPad を **USB で映して見る・絵から文字を読む**ところまでは、端末に何も入れずにできます。
**押す・打つ**には、端末の中で動く **WebDriverAgent**（WDA）の口が要ります（決定 C99）。

WDA は Appium のプロジェクトが公開している OSS（BSD ライセンス）です。git-qa には同梱していません。
**署名して端末へ入れるのは人の作業**です（Apple の開発者アカウントと、署名の鍵を使うため）。
git-qa は、人が起こした口の URL を `GIT_QA_IOS_WDA` で受け取って使うだけです。

---

## 要るもの

| | |
|---|---|
| Mac | **端末の iOS に対応した Xcode** が入っていること（下の「踏んだ穴 4」） |
| Apple の開発者アカウント | 組織のものを推します。署名の有効期限が約 1 年で、署名し直しは年 1 回程度です（無料の Apple ID でもできますが、7 日ごとに署名し直しが要ります） |
| iPhone / iPad | **デベロッパモード**が ON（設定 → プライバシーとセキュリティ）。Mac を「信頼」済み |
| 網 | **Mac と端末が同じ網にいること**（口は端末の網のアドレスで開きます） |

---

## 起こし方（初回）

### 1. WebDriverAgent を取ってくる（git-qa の外に置く）

```bash
git clone --depth 1 https://github.com/appium/WebDriverAgent.git
open WebDriverAgent/WebDriverAgent.xcodeproj
```

### 2. Xcode で署名を設定する

左の一覧でいちばん上の `WebDriverAgent` を選び、TARGETS の次の 2 つで「Signing & Capabilities」を開く。

| ターゲット | すること |
|---|---|
| `WebDriverAgentLib` | **Automatically manage signing** を ON、**Team** を選ぶ |
| `WebDriverAgentRunner`（末尾に `_tvOS` などが無いもの） | 同じく ON・Team を選び、**Bundle Identifier を自分の組織のものに変える**（例 `com.example.WebDriverAgentRunner`） |

### 3. 端末の準備

- ロックを解除し、**自動ロックを「なし」**にする（途中で画面が落ちると切れます）
- USB で繋ぎ、「このコンピュータを信頼」

### 4. 建てて起こす（**初回は自分の端末で打つ**）

```bash
cd WebDriverAgent
xcodebuild -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner \
  -destination 'id=<端末の識別子>' \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration test
```

- 端末の識別子は `xcrun xctrace list devices` の括弧の中です
- `-allowProvisioningDeviceRegistration` は、**端末を開発者アカウントに登録**します（未登録だと署名できません）
- 途中で「codesign がキーチェーンの鍵を使おうとしています」と出たら、Mac のパスワードを入れて**「常に許可」**
- 端末に「信頼されていないデベロッパ」と出たら、端末の 設定 → 一般 → VPN とデバイス管理 で信頼する

うまくいくと、次の行が出て**止まらずに動き続けます。**これが口です。止めずに置いておきます。

```
ServerURLHere->http://<端末のアドレス>:8100<-ServerURLHere
```

### 5. git-qa に渡す

```bash
export GIT_QA_IOS_WDA=http://<端末のアドレス>:8100
pnpm doctor          # 「✓ iPhone を押す口 — WebDriverAgent … 端末 iOS …」と出れば使えます
pnpm run:sheet:ios <検証シート.tsv>
```

**2 回目からは手順 4 だけ**で起こせます（署名が切れるまで）。

---

## 踏んだ穴

| | 出たもの | 抜け方 |
|---|---|---|
| 1 | Bundle Identifier が `com.facebook…` のままで、署名できない | 手順 2 で自分の組織のものに変える |
| 2 | `Device "…" isn't registered in your developer account` | `-allowProvisioningDeviceRegistration` を付けて走らせる（端末が開発者アカウントに 1 台登録されます） |
| 3 | `errSecInternalComponent`（CodeSign failed） | 裏で走らせた `xcodebuild` は、キーチェーンの許可を聞けずに落ちる。**初回は自分の端末で打ち**、出た許可で「常に許可」を押す |
| 5 | 期待結果の文字が「現れなかった」で `FAIL` | 前のケースで画面をなぞったままだと、その文字が画面の外にある。**期待結果には、その時に見えている文字を選ぶ** |
| 4 | `needs to be prepared for development`・`ddiServicesAvailable: false` | **Xcode が端末の iOS に対応していない。**Xcode（必要なら macOS も）を、端末の iOS に対応した版にする。対応していない Mac では、その iOS の端末は使えません |

---

## いまできること・まだ無いもの

- **押す**（画面の文字で指す・座標で指す）・**打つ**（焦点の欄へ。欄を指せば先に押す）・**なぞる**
- 口があるときは、**判定のための画面の絵も WDA から取ります**（USB で映す口は、前のプロセスが手放した直後に 10 秒以上見えなくなり、手順ごとに撮ると落ちたため）。人が見る映像は、これまでどおり USB で映します
- **何をどう押したか**は、証跡の手順に残ります
- **実機での確認**（iOS 17.5.1）：
  - 絵から「設定」を探して押し、設定アプリが開いた
  - 検証シートを無人で通した（`pnpm run:sheet:ios <シート> --no-ui`）。押す・画面を読む・判定まで、人の手を使わずに流れた
- **まだ無いもの**：キーを押す・長押し・アプリを名前で起動する
