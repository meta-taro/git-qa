/**
 * **走行中に相手が変わったことを、証跡に残す**（外部レビュー meta-taro/git-qa#3）。
 *
 * > シートは同一性を持っているのに、検証対象は持っていません。
 * > 前半 5 件は旧ビルド、後半 5 件は新ビルド、という証跡を作ります。
 * > そして `run.json` を読んだ人には、それが 1 つのビルドに見えます。
 *
 * **止めない。**この道具の考え方は「止める」ではなく「見る場所を絞る」なので、
 * **変わったことが読めれば足りる。**
 *
 * 実際に起きる形は地味で、誰も悪意を持っていない。
 * 同じ機械でその製品を開発しているセッションが再ビルドする、`pnpm dev` が
 * ホットリロードする、検証の途中で誰かが更新を当てる。
 *
 * **「変わっていない」と「測れなかった」を混ぜない**（録画・画面と同じ考え方）。
 * 測れない相手を「変わっていない」と書くと、**無い保証があるように読める。**
 */

export type TargetCheck =
  | { readonly state: 'same'; readonly before: string; readonly after: string }
  | { readonly state: 'changed'; readonly before: string; readonly after: string }
  | { readonly state: 'unmeasurable'; readonly reason: string };

/**
 * 走る前と後の指紋を突き合わせる。
 *
 * 指紋の作り方は**相手ごとに違う**ので、ここでは中身を見ない。
 * 同じかどうかだけを見る。
 */
export function compareFingerprint(
  before: string | undefined,
  after: string | undefined,
): TargetCheck {
  if (before === undefined && after === undefined) {
    return { state: 'unmeasurable', reason: 'この相手は、同じものかどうかを測る口を持っていない' };
  }
  if (before === undefined) {
    return { state: 'unmeasurable', reason: '走る前の相手を測れなかった（後だけ測れている）' };
  }
  if (after === undefined) {
    return {
      state: 'unmeasurable',
      reason: '走り終えた後の相手を測れなかった（相手が居なくなったのかもしれない）',
    };
  }

  return before === after ? { state: 'same', before, after } : { state: 'changed', before, after };
}
