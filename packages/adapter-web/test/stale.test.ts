import { describe, expect, it } from 'vitest';

import {
  STALE_MARK,
  forgetLaunched,
  killLaunchedSync,
  rememberLaunched,
  staleBrowserPids,
  staleReport,
} from '../src/stale.js';

/**
 * **置き去りのブラウザを片付ける**（meta-taro/git-qa#20）。
 *
 * ウェブ検証は 1 回ごとに**使い捨てプロファイル**のブラウザを立てる。
 * 行儀よく止めれば片付くが、**実行器を強制終了すると残る。**
 * 2026-09-15、切り分けのために起動と強制終了を繰り返し、**30 個溜めた。**
 * 使う人には **Dock がブラウザだらけ**になる形で見える。
 *
 * ## 緩めないところ
 *
 * **人が普段使っているブラウザには触らない。**落としてよいのは
 * **自分が使い捨てプロファイルで立てたものだけ。**
 * ここを雑にすると、**人の開いているタブを消す**という、
 * いちばんやってはいけない壊れ方になる。
 */
/** `ps -Ao pid,ppid,command` の 1 行。**親が 1 なら、起こした実行器はもう居ない。** */
const line = (pid: number, command: string, ppid = 1): string =>
  `${String(pid)} ${String(ppid)} ${command}`;

describe('staleBrowserPids', () => {
  it('使い捨てプロファイルのものだけを拾う', () => {
    const ps = [
      line(100, `/Applications/Google Chrome.app/…/Chrome --user-data-dir=/tmp/${STALE_MARK}ab12`),
      line(200, '/Applications/Google Chrome.app/…/Chrome'),
      line(300, '/Applications/Firefox.app/…/firefox -P personal'),
    ].join('\n');

    expect(staleBrowserPids(ps)).toEqual([100]);
  });

  /** **人のプロファイルには触らない。**名前が似ていても、印が無ければ拾わない。 */
  it('人のプロファイルは拾わない', () => {
    const ps = [
      line(100, 'Chrome --user-data-dir=/Users/someone/Library/Application Support/Google/Chrome'),
      line(101, 'Chrome --user-data-dir=/Users/someone/git-qa-web-mine'),
    ].join('\n');

    // 2 つ目は家の下。**仮置き場の印ではない**ので拾わない。
    expect(staleBrowserPids(ps)).toEqual([]);
  });

  it('自分自身は拾わない（いま使っているもの）', () => {
    const ps = [
      line(100, `Chrome --user-data-dir=/tmp/${STALE_MARK}aaa`),
      line(200, `Chrome --user-data-dir=/tmp/${STALE_MARK}bbb`),
    ].join('\n');

    expect(staleBrowserPids(ps, ['/tmp/' + STALE_MARK + 'bbb'])).toEqual([100]);
  });

  it('読めない行は飛ばす（数えられないものを落としに行かない）', () => {
    expect(staleBrowserPids(`これは行ではない\n\n`)).toEqual([]);
  });

  /**
   * **いま走っている実行のブラウザは落とさない**（2026-09-15・入れる前に気づいた）。
   *
   * 2 本同時に検証している人の、**1 本目を落とすところだった。**
   * 置き去りかどうかは「親がもう居ない」で見分ける ——
   * 親が死ぬと、macOS では親が `1`（launchd）に付け替わる。
   */
  it('親が生きているものは、いま使われている', () => {
    const ps = [
      line(100, `Chrome --user-data-dir=/tmp/${STALE_MARK}aaa`, 1),
      line(200, `Chrome --user-data-dir=/tmp/${STALE_MARK}bbb`, 4567),
    ].join('\n');

    expect(staleBrowserPids(ps)).toEqual([100]);
  });
});

describe('staleReport', () => {
  /** **黙って落とさない。**何を落としたのかが人に見えないと、次に疑うのは自分の窓になる。 */
  it('落としたものを数えて言う', () => {
    expect(staleReport(3)).toContain('3');
    expect(staleReport(3)).toContain('前の実行');
  });

  it('無ければ、何も言わない', () => {
    expect(staleReport(0)).toBeUndefined();
  });
});

/**
 * **合図を受けた瞬間に、同期で落とす**（meta-taro/git-qa#20・2026-09-16 に実測）。
 *
 * `SIGINT` を受けてから `close()` を辿る道を入れたのに、**ブラウザは残った。**
 * 同じプロセスで動いている vite も合図を受けて先に終わるので、
 * **こちらの後始末は最後まで走らない。**
 *
 * **待たない形が要る。**起こしたブラウザの番号を覚えておき、合図の中で直接落とす。
 * 非同期を 1 つでも挟むと、そこで終わることがある。
 */
describe('killLaunchedSync', () => {
  it('覚えているものを、その場で落とす', () => {
    const killed: number[] = [];
    rememberLaunched(4242);

    killLaunchedSync((pid) => killed.push(pid));

    expect(killed).toEqual([4242]);
  });

  /** **2 度落としに行かない。**落とした番号は別の誰かのものになりうる。 */
  it('一度落としたら、忘れる', () => {
    const killed: number[] = [];
    rememberLaunched(4243);
    killLaunchedSync(() => undefined);

    killLaunchedSync((pid) => killed.push(pid));

    expect(killed).toEqual([]);
  });

  it('自分で閉じたものは、落としに行かない', () => {
    const killed: number[] = [];
    rememberLaunched(4244);
    forgetLaunched(4244);

    killLaunchedSync((pid) => killed.push(pid));

    expect(killed).toEqual([]);
  });

  /** **落とせなくても、残りを落とす。**1 つの失敗で片付けを止めない。 */
  it('落とせないものが在っても、残りは落とす', () => {
    const killed: number[] = [];
    rememberLaunched(1);
    rememberLaunched(2);

    killLaunchedSync((pid) => {
      if (pid === 1) throw new Error('もう居ない');
      killed.push(pid);
    });

    expect(killed).toEqual([2]);
  });
});
