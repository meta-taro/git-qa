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

/**
 * **その行だけの待ち**（外部レビュー meta-taro/git-qa#39 の提案 2・2026-10-23・C105）。
 *
 * 相手先のサイトを人の速さで回るアプリでは、結果が出るまで**数分**かかる。
 * 見出しの `# 待つ:` で全体を延ばすと、**落ちる行がみな数分ずつ遅くなる。**
 * **遅い行だけ**、期待結果の欄に `（最大 5 分）` / `（15秒まで待つ）` を添える。
 *
 * **上限は 10 分。**行ごとなので見出しより長くてよいが、
 * 打ち間違い（`50 分`）で人が止めるしかなくなる実行は作らない。
 */
const MAX_ROW_WAIT_MS = 600_000;

/**
 * `（最大 5 分）` / `（15秒まで待つ）`。半角の括弧も。**中身は後で読む。**
 *
 * **「最大」は時間の単位で終わるときだけ**待ちとみなす ——
 * `（最大 10 件）` のような但し書きはよくあり、それを止めてはいけない。
 * **「まで待つ」は言い方そのものが待ち**なので、読めなければ止める。
 */
const ROW_WAIT =
  /\s*[（(]\s*(?:最大\s*([^（）()]*?(?:ミリ秒|秒|ms|s|分|min|時間|h))|([^（）()]*?)\s*まで待つ)\s*[）)]/g;

const badRow = (said: string): Error =>
  new Error(
    `期待結果に添えた待つ長さが読めない: ${said}。` +
      `「（最大 5 分）」「（15秒まで待つ）」の形で、秒か分で書く。上限は ${String(MAX_ROW_WAIT_MS / 60_000)} 分`,
  );

export interface RowWait {
  /** 待ちの言い方を外した期待結果。**見る文字に混ぜない。** */
  readonly text: string;
  /** 添えていなければ無し（見出しか既定のまま）。 */
  readonly waitMs?: number;
}

/**
 * 期待結果の欄から、その行だけの待ちを取り出す。
 *
 * **待ちの言い方なのに読めないものは投げる**（C20）。
 * 「5 分待つつもりで 2 秒だった」が、**いちばん気づけない。**
 */
export function rowWait(expected: string): RowWait {
  const found = [...expected.matchAll(ROW_WAIT)];
  if (found.length === 0) return { text: expected };
  if (found.length > 1) throw badRow(found.map((m) => m[0].trim()).join(' と '));

  const hit = found[0] as RegExpMatchArray;
  const said = (hit[1] ?? hit[2] ?? '').trim();
  const matched = /^(\d+(?:\.\d+)?)\s*(秒|s|分|min)$/.exec(said);
  if (matched === null) throw badRow(hit[0].trim());

  const amount = Number(matched[1]);
  const ms = Math.round(amount * (matched[2] === '分' || matched[2] === 'min' ? 60_000 : 1000));
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_ROW_WAIT_MS) throw badRow(hit[0].trim());

  const at = hit.index ?? 0;
  return { text: expected.slice(0, at) + expected.slice(at + hit[0].length), waitMs: ms };
}
