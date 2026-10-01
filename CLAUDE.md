# git-qa

> このリポジトリは、人と AI エージェント（Claude Code）が一緒に開発することを前提に構成されています。
> AI エージェントは以下を必ず守ってください。

## 必読

- **`docs/handoff.md`**（**手元だけ**・git に入れない）— **立ち上げ直したら、まずここ。**
  いまの状態・**踏んだ穴**・止まっているもの・次の一手が 1 枚に在る。
  **人は替わらなくてもセッションは終わる。**終わった側が覚えていたことは、
  書いていなければ次に渡らない。
- **`.claude/rules/product-baseline.md`** — 開発のベースルール。**最優先で従うこと**。
- **`PRD.md`** — このプロダクトの方向性・仕様。
- **`docs/decisions.md`** — 技術的な決定と、その理由（公開。コードのコメントが `C57` のように番号で指す）。
- **`.claude/roadmap.md`**・**`.claude/issues/`**（**手元だけ**）— フェーズと進め方・着手すべきローカル Issue。

## 守ることの要点（詳細は product-baseline.md）

- pnpm のみ使用（npm / yarn 禁止）。
- 実装前に計画を立てる。小さいフェーズで作業。**テストを後回しにしない／落ちるテストを消さない。**
- **commit は AI、push は人間。**人間の確認なしに push しない。
- 秘密情報（API キー・トークン・接続文字列）は **AI が作らない・置かない・貼らない。**`.env.example` には変数名だけを書く。
- 進捗は `.claude/project-status.md`（手元だけ）に随時記録。**テストが無い状態で「完了」と書かない。**
- **public リポジトリです。**コード・文書・commit history に個人名・個人メールアドレスを残さないこと（`.github/workflows/oss-privacy-check.yml` が検出します）。

## 公開するもの・しないもの

- **作業の記録は git に入れない。**`.claude/` の記録（project-status・issues・roadmap・decisions の元）と `docs/handoff.md` は**手元だけ**に置く。
  `.gitignore` の `/.claude/*` と、置き場所の検査（`.github/scripts/oss-placement-check.sh`・CI と commit 前・push 前に走る）が止める。
  mac と win の両方で使う記録は、非公開の `git-qa-notes` ができるまで各機の手元に置く。
- git に入るもの・GitHub に出すもの（Issue / PR / コメント / Release / commit メッセージ / タグ）は、
  **「このリポの外を何も知らない人が読んで意味が通るか」**で判断する。
  ルール番号・役割名・人名・社名・**非公開の**リポ名・手元のパス・運用の宣言（push 待ち等）・「読みました」だけの返事は書かない。
  公開リポの名前（md-business など）は書いてよい。
- **会話を公開しない。**人とのやり取り・他のセッションとのやり取りを引用しない。決まったこと・理由・事実だけを書く。
- 社内の連絡には Issue を使わない（セッション間のメッセージで行う）。**社外の人のバグ報告の窓口としては Issue を残す。**

## 進捗管理

- `.claude/project-status.md`（手元だけ）… 現在フェーズ・完了/未完了・次タスク・既知問題
- `docs/decisions.md`（公開）… 技術的決定と、その理由。**外の人が読んで意味が通る形で書く**

## 日課（AI エージェント向け）

### セッション開始時

1. `git pull --ff-only`
2. `gh issue list --state open` ＋ `gh issue list --state closed --limit 10`
   （**close 済 Issue にも後追いで指示や訂正が入ることがあるため、必ず両方見る**）
3. open Issue は全件 `gh issue view <番号> --json title,body,comments,author,createdAt --jq '.'` で本文＋コメントを確認
   （`--comments` は出力が空のまま exit 0 することがあり、「読んだが何も無かった」と区別できないため使わない）
4. 何を確認し、どれから着手するかを返す

### Issue への反応（着手前）

- 新規 Issue・新規コメントには、**着手前に最低 1 回反応する。**ただし Issue は公開されるので、
  **「読みました」だけにせず、外の人が読んで意味が通る中身**（どう扱うか・いつまでに）で返す
- **沈黙は「読んでいない」「止まっている」「無視した」と区別がつきません。**
- 「承知しました」だけを返さない。**できていないなら、できていないと認め、対策と日付を出す。**前提がおかしいと思うなら異議・代案を出す。

### セッション終了時

1. `.claude/project-status.md` に進捗を記録（テストが無い状態で「完了」と書かない）
2. 完了した Issue は `gh issue close <番号> --comment "..."`

### git pull の 3 タイミング

1. **セッション開始時**: `git pull --ff-only`
2. **commit する直前**: `git pull --rebase --ff-only`
3. **人間が push するとき**: ff エラーなら `pull --rebase` してから再 push
