import { t } from '../i18n/current.js';
import type { MessageKey } from '../i18n/index.js';
import { MAIN_COLUMN_ID } from '../columns.js';
import { markFor } from './marks.js';

/**
 * 置いた判定を、押した直後に**前面へ出す。**
 *
 * 2026-09-04、実物を触った人の指定:「合格、不合格を押した時に前面に🚫不合格みたいに
 * だしてほしい。そっちのほうが、人はおしまちがいにきづける」。
 *
 * **押し間違いは「キーを離す」より「気づかせる」ほうが確実。**隣り合わせは必ずできるが、
 * 出せば毎回気づける。**ライブビューを隠し続けないよう、すぐ消える。**
 */

/** 出しておく時間。**長いと映像が見えない。短いと気づけない。** */
export const FLASH_MS = 900;

const LABELS: Readonly<Record<string, MessageKey>> = {
  VERIFIED: 'flash.verified',
  FAIL: 'flash.fail',
  BLOCKED: 'flash.blocked',
  SKIP: 'flash.skip',
  AUTO_PASS: 'flash.autoPass',
};

/** 消灯の予約。**続けて押されたら入れ直す**（前の予約が後のものを消してはいけない）。 */
let timer: number | undefined;

export function flashVerdict(root: HTMLElement, result: string): void {
  const labelKey = LABELS[result];
  if (labelKey === undefined) return;

  const doc = root.ownerDocument;
  const live = root.querySelector<HTMLElement>(`[data-column-id="${MAIN_COLUMN_ID}"]`);
  if (live === null) return;

  live.querySelector('.verdict-flash')?.remove();
  if (timer !== undefined) clearTimeout(timer);

  const flash = doc.createElement('div');
  flash.className = 'verdict-flash';
  flash.dataset['result'] = result;
  // 読み上げにも届かせる。**目を離していても分かるように。**
  flash.setAttribute('role', 'status');
  flash.textContent = `${markFor(result)} ${t(labelKey)}`;
  live.append(flash);

  timer = setTimeout(() => {
    flash.remove();
    timer = undefined;
  }, FLASH_MS) as unknown as number;
}
