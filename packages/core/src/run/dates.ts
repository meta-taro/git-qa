/**
 * **流した日から決まる言い方を、実際の日付にする**（外部レビュー meta-taro/git-qa#29）。
 *
 * > **書いた日にしか通らない行ができる。**…腐り方が**時間とともに静かに進む**ので、
 * > シートを書いた直後は緑で、誰も触っていないのに数週間後から赤くなる。
 *
 * **語彙は狭くする。**「翌月の 1 日」のような言い方は入れない ——
 * **曖昧なものを当てにいくと、判定が別のことを見る**（#27 で踏んだばかり）。
 * 知らない言い方は**そのまま残して人へ渡す。**
 *
 * **何に展開したかは証跡へ残す**（報告者が「形より大事」と書いた所）。
 * 残っていなければ、**後から読んだ人が、その run が何日を押したのか復元できない。**
 */

/** シートの見出しで、画面の日付の書き方を指定する（`# 行き先:` と同じ置き方）。 */
export const DATE_FORMAT_KEY = '日付の書き方';

/** 知っている書き方だけ。**知らないものは既定に落とす**（当てにいかない）。 */
const FORMATS: Record<string, (at: Date) => string> = {
  'YYYY-MM-DD': (at) => `${year(at)}-${two(at.getMonth() + 1)}-${two(at.getDate())}`,
  'YYYY/MM/DD': (at) => `${year(at)}/${two(at.getMonth() + 1)}/${two(at.getDate())}`,
  'M/D': (at) => `${String(at.getMonth() + 1)}/${String(at.getDate())}`,
  'MM/DD': (at) => `${two(at.getMonth() + 1)}/${two(at.getDate())}`,
  D: (at) => String(at.getDate()),
  M月D日: (at) => `${String(at.getMonth() + 1)}月${String(at.getDate())}日`,
};

const two = (n: number): string => String(n).padStart(2, '0');
const year = (at: Date): string => String(at.getFullYear());

export function formatDate(at: Date, format: string | undefined): string {
  const shape = format === undefined ? undefined : FORMATS[format.trim()];
  return (shape ?? FORMATS['YYYY-MM-DD'] ?? (() => ''))(at);
}

/** 何を何に展開したか。**証跡へそのまま残す。** */
export interface ResolvedDate {
  readonly said: string;
  readonly resolved: string;
}

export interface ExpandedText {
  readonly text: string;
  readonly dates: readonly ResolvedDate[];
}

/**
 * 知っている言い方。**今日・明日・昨日・今日から N 日後 / N 日前**まで。
 *
 * **狭く始める。**足りない言い方は、**実際に書けなかったものを教わってから**足す。
 */
const RELATIVE = /今日から\s*(\d+)\s*日(後|前)|今日|明日|昨日/g;

const shift = (from: Date, days: number): Date => {
  // **足し算を自分で書かない。**月またぎ・うるう年は `Date` に任せる。
  const at = new Date(from.getTime());
  at.setDate(at.getDate() + days);
  return at;
};

export function expandDates(text: string, now: Date, format: string | undefined): ExpandedText {
  const dates: ResolvedDate[] = [];

  const expanded = text.replace(
    RELATIVE,
    (said, count: string | undefined, way: string | undefined) => {
      const days =
        count === undefined
          ? said === '明日'
            ? 1
            : said === '昨日'
              ? -1
              : 0
          : Number(count) * (way === '前' ? -1 : 1);
      const resolved = formatDate(shift(now, days), format);
      dates.push({ said, resolved });
      return resolved;
    },
  );

  return { text: expanded, dates };
}
