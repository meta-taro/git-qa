import { t } from '../i18n/current.js';

/**
 * **届いているのに描けていないなら、そう言う**（meta-taro/git-qa#18）。
 *
 * 映像の種類を取り違えて **JPEG を H.264 の復号器へ流し込んでいた**とき、
 * 復号器は待つだけなので**例外も記録も出ず、ただ真っ白**になった。
 *
 * **「来ていない」と「描けていない」は別の話。**
 * 前者は繋ぎ直しの側で扱う。ここが言うのは後者だけ。
 */
export function liveStallMessage(seen: {
  readonly bytes: number;
  readonly drawn: number;
  readonly kind: string;
}): string | undefined {
  if (seen.bytes <= 0 || seen.drawn > 0) return undefined;
  return t('live.stalled', { bytes: String(seen.bytes), kind: seen.kind });
}
