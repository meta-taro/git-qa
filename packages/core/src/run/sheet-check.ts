import { createHash } from 'node:crypto';

import type { TargetCheck } from './target-check.js';
import type { LiveViewEvent, SheetRef } from './types.js';

/**
 * **証跡が何に対して置かれたのかを、後から確かめる。**
 *
 * 外部のレビューで指摘を受けて足した（meta-taro/git-qa#1・2026-09-11）。
 *
 * > シートの `sha256` は毎回書かれているが、読む側がどこにも無い。
 * > 検出は「原理的には可能」であって、**何も検出していません**。
 *
 * そのとおりだった。書く側は 4 箇所あるのに、突き合わせる本番コードは 0 件で、
 * **型のコメントだけが「突き合わせで分かる」と言っていた。**
 *
 * `VERIFIED` は署名であってロックではない（README）。だとすれば、
 * **署名が何に対して置かれたのかが動かないこと**が要る。
 */

/** 証跡に書く側と同じ数え方。**ここを正本にして、書く側もここを使う。** */
export function sheetDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 64 文字の 16 進。**形が違うものを「同じ」と言わない。** */
const DIGEST = /^[0-9a-f]{64}$/;

export type SheetCheck =
  /** 証跡を置いたときのシートと、いまのシートが同じ。 */
  | { readonly kind: 'same'; readonly reason: string }
  /** 変わっている。**判定は、いまの文面に対して置かれたものではない。** */
  | { readonly kind: 'changed'; readonly reason: string }
  /** シートが読めない（消された・場所が変わった）。**変わったこととは別。** */
  | { readonly kind: 'missing'; readonly reason: string }
  /** 記録されたハッシュ自体が読めない。**手で書き換えられた証跡かもしれない。** */
  | { readonly kind: 'unreadable'; readonly reason: string };

/**
 * 証跡のシート情報と、いまのシートの中身を突き合わせる。
 *
 * **4 つを混ぜない。**「変わった」「消えた」「記録が壊れている」「同じ」は、
 * 人が次にやることがそれぞれ違う。
 */
export function compareSheet(recorded: SheetRef, current: string | undefined): SheetCheck {
  if (!DIGEST.test(recorded.sha256)) {
    return {
      kind: 'unreadable',
      reason:
        `証跡に書かれているシートの値が、形からして読めない: ${recorded.sha256}。` +
        '手で書き換えられた証跡かもしれない',
    };
  }

  if (current === undefined) {
    return {
      kind: 'missing',
      reason:
        `突き合わせる相手のシートが読めない: ${recorded.path}。` +
        '消されたか、場所が変わった。**判定が何に対して置かれたのかを確かめられない**',
    };
  }

  const now = sheetDigest(current);
  if (now === recorded.sha256) {
    return { kind: 'same', reason: `シートは、判定を置いたときと同じ（${short(now)}）` };
  }

  return {
    kind: 'changed',
    reason:
      `シートが変わっている。判定を置いたとき ${short(recorded.sha256)} / ` +
      `いま ${short(now)}。**この証跡の判定は、いまの文面に対して置かれたものではない**`,
  };
}

/** 64 文字を全部出しても人は読めない。**頭だけ出して、見分けが付く長さにする。** */
const short = (digest: string): string => digest.slice(0, 12);

/** 突き合わせるのに要る、証跡の最小限。**`run.json` を全部知らなくてよい。** */
export interface CheckedRun {
  readonly runId: string;
  readonly sheet: SheetRef;
  readonly cases: readonly { readonly no: number; readonly result?: string }[];
  /** 相手が走行中に入れ替わっていないか。**古い証跡は持っていない。** */
  readonly targetCheck?: TargetCheck;
  /** 画面が映像を読みに来た／離れた時刻（#33）。**画面を持たない実行と古い証跡には無い。** */
  readonly liveView?: readonly LiveViewEvent[];
}

/**
 * 映像が離れて戻ったかを、報告に 1 行で出す（meta-taro/git-qa#33）。
 *
 * > 判定待ちで放置している間に切れて自分で戻ると、あとで見た人には何も残りません。
 *
 * **知りたいのは 3 つ** ——離れたのか、何秒で戻ったのか、戻らなかったのか。
 * **「切断」とは書かない。**配る側から見えるのは読み手の出入りだけ。
 * **持っていない証跡には、何も足さない。**
 */
function renderLiveView(events: readonly LiveViewEvent[] | undefined): string[] {
  if (events === undefined) return [];

  /*
   * **数えて、誰も居なくなった間だけを「離れた」とする**（2026-09-28）。
   * 再読み込みでは新しい接続が古い接続より先に来ることがある（joined → joined → left）。
   * 1 人しか居ない前提で読むと、**「離れたまま」と誤って書く。**
   */
  const gaps: number[] = [];
  let leftAt: string | undefined;
  let watching = 0;
  for (const one of events) {
    if (one.kind === 'left') {
      watching = Math.max(0, watching - 1);
      if (watching === 0) leftAt = one.at;
      continue;
    }
    if (watching === 0 && leftAt !== undefined) {
      gaps.push(Date.parse(one.at) - Date.parse(leftAt));
    }
    watching += 1;
    leftAt = undefined;
  }

  // **戻らなかったことが、いちばん知りたいこと。**先に言う。
  if (leftAt !== undefined) return [`映像: 最後に離れたまま戻っていない（${leftAt}）`];
  if (gaps.length === 0) return ['映像: 走っている間、離れていない'];

  const seconds = (ms: number): string => (Math.round(ms / 100) / 10).toFixed(1);
  if (gaps.length === 1) return [`映像: 1 回離れて、${seconds(gaps[0] ?? 0)} 秒で戻った`];
  return [
    `映像: ${String(gaps.length)} 回離れて、どれも戻った（いちばん長くて ${seconds(Math.max(...gaps))} 秒）`,
  ];
}

/**
 * 相手が入れ替わっていないかを、報告に 1 行で出す（外部レビュー meta-taro/git-qa#3）。
 *
 * **`run.json` に書いてあるだけでは足りない。**読む人が開くのは報告のほう。
 * **持っていない証跡には、何も足さない**（無いものを「測れなかった」と言い換えない）。
 */
function renderTargetCheck(check: TargetCheck | undefined): string[] {
  if (check === undefined) return [];
  if (check.state === 'unmeasurable') {
    return [`検証対象が入れ替わっていないかは、測れていない（${check.reason}）`];
  }
  if (check.state === 'same') return ['検証対象は、走っている間ずっと同じ'];

  return [
    '検証対象が、走っている途中で入れ替わっている',
    `  走る前: ${check.before}`,
    `  走った後: ${check.after}`,
    '  **前半と後半で、別のものを見ている。**どこで入れ替わったかは証跡から読む',
  ];
}

/** **人が見て置いたもの。**`AUTO_PASS` と `SKIP` は入らない（人は見ていない）。 */
const PLACED_BY_HUMAN = new Set(['VERIFIED', 'FAIL', 'BLOCKED']);

/**
 * 突き合わせた結果を、人が読める形にする。
 *
 * **人が置いた件数を必ず出す。**シートが変わっていたとき、
 * **失われるのは人が見て置いた分**なので、そこが何件あるのかを
 * 読んだ人はいちばん知りたい。
 */
export function renderSheetCheck(run: CheckedRun, check: SheetCheck): string {
  const placed = run.cases.filter(
    (one) => one.result !== undefined && PLACED_BY_HUMAN.has(one.result),
  ).length;

  const head =
    run.sheet.title === undefined ? run.sheet.path : `${run.sheet.title}（${run.sheet.path}）`;

  return [
    `証跡: ${run.runId}`,
    `シート: ${head}`,
    `人が見て置いた判定: ${String(placed)} 件 / 全 ${String(run.cases.length)} 件`,
    ...renderTargetCheck(run.targetCheck),
    ...renderLiveView(run.liveView),
    '',
    check.reason,
  ].join('\n');
}
