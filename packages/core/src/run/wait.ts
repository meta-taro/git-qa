/**
 * **期待結果が出るまで待つ長さを、シートから決める**（外部レビュー meta-taro/git-qa#39）。
 *
 * > **製品は正常なのに FAIL が出ます。**
 * > キャプチャを見たら、入力も押下も成功していました。…
 * > つまり落ちたのは**アプリの不具合ではなく、待ち切る前に見切ったから**です。
 *
 * 既定は 2 秒（`case-runner.ts`）。**開いて読むだけのページなら足りる。**
 * **押すとサーバを 1 往復する行**では足りない ——
 * ログイン（認証 → リダイレクト）、採番してから遷移、サーバが解決を書き戻すまで数秒。
 * **足りないのは回数ではなく締切だった**（最低 2 回は読んでいる）。
 *
 * **CLI の引数にはしない。**報告者自身が薦めていない。
 *
 * > 実行のたびに変わる値がシートの外にあると、`run.json` を読んだ人が
 * > 「この FAIL は待ち不足か、製品の問題か」を判断できなくなります
 *
 * **シートに書けば、証跡の `sha256` から後で復元できる**（`#22` と同じ理由・C40）。
 * **証跡に新しい欄を足さなくてよい**のも、この形の良さ。
 */

/** シートの見出し。`# 待つ: 8s` */
export const WAIT_KEY = '待つ';

/**
 * **上限。**打ち間違い（`800s`）で**1 件が 13 分**になると、人は止めるしかなくなり、
 * 証跡が中断で残る。**気づけない失敗を作らない。**
 */
const MAX_WAIT_MS = 120_000;

const bad = (said: string): Error =>
  new Error(
    `シートの見出し「# ${WAIT_KEY}:」が読めない: ${said}。` +
      `秒で書く（例 8s / 8秒 / 8）。ミリ秒なら 8000ms。上限は ${String(MAX_WAIT_MS / 1000)} 秒`,
  );

/**
 * `# 待つ:` を読む。**書いていなければ `undefined`**（既定のまま）。
 *
 * **読めないものは投げる。**黙って既定に落とすと、
 * **「8 秒待つつもりで書いたのに 2 秒だった」**が起きて、**それがいちばん気づけない**（C20）。
 */
export function sheetWaitMs(meta: Record<string, string>): number | undefined {
  const said = meta[WAIT_KEY]?.trim();
  if (said === undefined || said === '') return undefined;

  // `8s` / `8 s` / `8秒` / `8000ms` / `8`（単位なしは秒。**人は秒で考える**）
  const matched = /^(\d+(?:\.\d+)?)\s*(ms|s|秒)?$/.exec(said);
  if (matched === null) throw bad(said);

  const amount = Number(matched[1]);
  const unit = matched[2];
  const ms = unit === 'ms' ? amount : amount * 1000;

  if (!Number.isFinite(ms) || ms <= 0) throw bad(said);
  if (ms > MAX_WAIT_MS) throw bad(said);
  return Math.round(ms);
}
