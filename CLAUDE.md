# git-qa

> このリポジトリは、人と AI エージェント（Claude Code）が一緒に開発することを前提に構成されています。
> AI エージェントは以下を必ず守ってください。

## 必読

- **`.claude/rules/product-baseline.md`** — 開発のベースルール。**最優先で従うこと**。
- **`PRD.md`** — このプロダクトの方向性・仕様。
- **`.claude/roadmap.md`** — フェーズと進め方。
- **`.claude/issues/`** — 着手すべきローカル Issue。

## 守ることの要点（詳細は product-baseline.md）

- pnpm のみ使用（npm / yarn 禁止）。
- 実装前に計画を立てる。小さいフェーズで作業。**テストを後回しにしない／落ちるテストを消さない。**
- **commit は AI、push は人間。**人間の確認なしに push しない。
- 秘密情報（API キー・トークン・接続文字列）は **AI が作らない・置かない・貼らない。**`.env.example` には変数名だけを書く。
- 進捗は `.claude/project-status.md` に随時記録。**テストが無い状態で「完了」と書かない。**
- **public リポジトリです。**コード・文書・commit history に個人名・個人メールアドレスを残さないこと（`.github/workflows/oss-privacy-check.yml` が検出します）。

## 進捗管理

- `.claude/project-status.md` … 現在フェーズ・完了/未完了・次タスク・既知問題
- `.claude/decisions.md` … 技術的決定と、その理由

## 日課（AI エージェント向け）

### セッション開始時

1. `git pull --ff-only`
2. `gh issue list --state open` ＋ `gh issue list --state closed --limit 10`
   （**close 済 Issue にも後追いで指示や訂正が入ることがあるため、必ず両方見る**）
3. open Issue は全件 `gh issue view <番号> --json title,body,comments,author,createdAt --jq '.'` で本文＋コメントを確認
   （`--comments` は出力が空のまま exit 0 することがあり、「読んだが何も無かった」と区別できないため使わない）
4. 何を確認し、どれから着手するかを返す

### Issue への反応（着手前）

- 新規 Issue・新規コメントには、**着手前に最低 1 回反応する**（「読みました。〇〇から着手します。」）
- **沈黙は「読んでいない」「止まっている」「無視した」と区別がつきません。**
- 「承知しました」だけを返さない。**できていないなら、できていないと認め、対策と日付を出す。**前提がおかしいと思うなら異議・代案を出す。

### セッション終了時

1. `.claude/project-status.md` に進捗を記録（テストが無い状態で「完了」と書かない）
2. 完了した Issue は `gh issue close <番号> --comment "..."`

### git pull の 3 タイミング

1. **セッション開始時**: `git pull --ff-only`
2. **commit する直前**: `git pull --rebase --ff-only`
3. **人間が push するとき**: ff エラーなら `pull --rebase` してから再 push
