import { describe, expect, it } from 'vitest';

import { DATE_FORMAT_KEY, expandDates, formatDate } from '../../src/run/dates.js';

/**
 * **書いた日にしか通らない行**（外部レビュー meta-taro/git-qa#29）。
 *
 * > しかも腐り方が**時間とともに静かに進む**ので、シートを書いた直後は緑で、
 * > 誰も触っていないのに数週間後から赤くなる。
 * >
 * > **検証の道具でいちばん高くつくのは偽の合格ですが、理由の分からない偽の不合格も、
 * > 次からログを読まれなくなるという形で同じくらい高く付きます。**
 *
 * **語彙は狭くする。**「翌月の 1 日」のような言い方は入れない ——
 * **曖昧なものを当てにいくと、判定が別のことを見る**（#27 で踏んだばかり）。
 */
const 水曜 = new Date('2026-09-16T10:00:00+09:00');

describe('expandDates — 流した日から決まる言い方を、実際の日付にする', () => {
  it('「今日」', () => {
    const done = expandDates('「今日」をクリックする', 水曜, 'YYYY-MM-DD');

    expect(done.text).toBe('「2026-09-16」をクリックする');
  });

  it('「今日から 2 日後」', () => {
    expect(expandDates('「今日から 2 日後」をクリックする', 水曜, 'YYYY-MM-DD').text).toBe(
      '「2026-09-18」をクリックする',
    );
  });

  it('「今日から 3 日前」', () => {
    expect(expandDates('「今日から 3 日前」をクリックする', 水曜, 'YYYY-MM-DD').text).toBe(
      '「2026-09-13」をクリックする',
    );
  });

  it('「明日」「昨日」', () => {
    expect(expandDates('「明日」', 水曜, 'YYYY-MM-DD').text).toBe('「2026-09-17」');
    expect(expandDates('「昨日」', 水曜, 'YYYY-MM-DD').text).toBe('「2026-09-15」');
  });

  /** **月をまたぐ。**足し算を自分で書かない（`Date` に任せる）。 */
  it('月をまたぐ', () => {
    expect(expandDates('「今日から 20 日後」', 水曜, 'YYYY-MM-DD').text).toBe('「2026-10-06」');
  });

  /**
   * **何に展開したかを残す**（報告者が「形より大事」と書いた所）。
   *
   * > **後から読んだ人が、その run が何日を押したのか復元できない。**
   */
  it('何を何に展開したかを返す', () => {
    const done = expandDates('「今日から 2 日後」をクリックする', 水曜, 'YYYY-MM-DD');

    expect(done.dates).toEqual([{ said: '今日から 2 日後', resolved: '2026-09-18' }]);
  });

  it('日付の言い方が無ければ、何も変えない', () => {
    const done = expandDates('「保存」をクリックする', 水曜, 'YYYY-MM-DD');

    expect(done.text).toBe('「保存」をクリックする');
    expect(done.dates).toEqual([]);
  });

  /** **知らない言い方は、当てにいかない**（#27 と同じ考え方）。そのまま残して人へ渡す。 */
  it('知らない言い方は、そのまま残す', () => {
    const done = expandDates('「翌月の 1 日」をクリックする', 水曜, 'YYYY-MM-DD');

    expect(done.text).toBe('「翌月の 1 日」をクリックする');
    expect(done.dates).toEqual([]);
  });

  /** **画面の書き方はシートが決める**（`# 日付の書き方:`）。相手の実装次第なので当てにいかない。 */
  it('シートが指定した書き方で展開する', () => {
    expect(expandDates('「今日」', 水曜, 'M/D').text).toBe('「9/16」');
    expect(expandDates('「今日」', 水曜, 'D').text).toBe('「16」');
  });
});

describe('formatDate', () => {
  it('既定は YYYY-MM-DD', () => {
    expect(formatDate(水曜, undefined)).toBe('2026-09-16');
  });

  it('知らない書き方なら、既定に落とす（当てにいかない）', () => {
    expect(formatDate(水曜, 'なんとか')).toBe('2026-09-16');
  });

  it('見出しの鍵は「日付の書き方」', () => {
    expect(DATE_FORMAT_KEY).toBe('日付の書き方');
  });
});
