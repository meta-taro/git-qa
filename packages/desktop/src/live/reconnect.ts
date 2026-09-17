import { t } from '../i18n/current.js';

/**
 * **映像が切れたら、繋ぎ直す**（外部レビュー meta-taro/git-qa#33）。
 *
 * > Load failed になりましたね。**このとき再接続みたいな案内がないのと、殺風景です。**
 *
 * 出ていたのは `Load failed` の 4 文字だけ。**何が切れたのかも、次に何が起きるかも
 * 書かれていない。**開発モードでは Vite の再読み込みで**毎回踏む。**
 *
 * **叩き続けない。**相手が落ちているときに 0.1 秒ごとに繋ぎに行くと、
 * ログが埋まり、機械も温まる。**だんだん間を空ける。**
 * ただし**無限には伸ばさない** —— 人が挿し直したときに、待たされ続ける。
 */

const FIRST_MS = 500;
const LIMIT_MS = 10_000;

export function nextRetryMs(attempt: number): number {
  return Math.min(LIMIT_MS, FIRST_MS * 2 ** Math.max(0, attempt));
}

/** **何が切れたのかと、次に何が起きるか**を言う。**元の言い分も落とさない。** */
export function retryMessage(reason: string, waitMs: number): string {
  const seconds = Math.round(waitMs / 100) / 10;
  return t('live.retry', { message: reason, seconds: String(seconds) });
}
