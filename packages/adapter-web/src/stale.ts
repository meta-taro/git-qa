import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

/**
 * **置き去りのブラウザを片付ける**（meta-taro/git-qa#20）。
 *
 * ウェブ検証は 1 回ごとに**使い捨てプロファイル**のブラウザを立てる。
 * 行儀よく止めれば片付くが、**実行器を強制終了すると残る。**
 * 2026-09-15、切り分けのために起動と強制終了を繰り返して **30 個溜めた。**
 * 使う人には **Dock がブラウザだらけ**になる形で見える。
 *
 * **拾える落ち方だけでは足りない**（`save-on-exit.ts` と同じ話）。
 * `SIGKILL`・電源・親ごと消える、では片付けの道が走らない。
 * **だから始めるときに、前の置き去りを見る。**
 *
 * ## 緩めないところ
 *
 * **人が普段使っているブラウザには触らない。**落としてよいのは
 * **自分が使い捨てプロファイルで立てたものだけ。**ここを雑にすると、
 * **人の開いているタブを消す**という、いちばんやってはいけない壊れ方になる。
 */

/** 使い捨てプロファイルの印。**この名前で立てたものだけが、片付けの対象。** */
export const STALE_MARK = 'git-qa-web-';

const run = promisify(execFile);

/**
 * `ps -Ao pid,ppid,command` の出力から、落としてよいものだけを拾う。
 *
 * 見るのは 2 つ。
 *
 * - **仮置き場の下にある印つきのプロファイル**だけ（家の下・印の無いものは人のもの）
 * - **親がもう居ない**もの（`ppid` が 1）。親が死ぬと `launchd` に付け替わる
 *
 * **2 つ目が肝。**これが無いと、**2 本同時に検証している人の 1 本目を落とす。**
 * 「残っている」と「いま使われている」は別の話。
 */
export function staleBrowserPids(
  psOutput: string,
  keepDirs: readonly string[] = [],
  temp: string = tmpdir(),
): number[] {
  const pids: number[] = [];
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;

    const [, said, parent, command] = match as unknown as [string, string, string, string];
    // **親が生きているなら、いま誰かが使っている。**置き去りではない。
    if (Number(parent) !== 1) continue;
    const dir = /--user-data-dir=(\S+)/.exec(command)?.[1];
    if (dir === undefined) continue;
    // **仮置き場の下の、印つきだけ。**家の下に同じ名前を作られても触らない。
    if (!dir.startsWith(temp) && !dir.startsWith('/tmp/')) continue;
    if (!dir.includes(`/${STALE_MARK}`)) continue;
    // いま使っているものは落とさない。
    if (keepDirs.includes(dir)) continue;

    const pid = Number(said);
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

/** **黙って落とさない。**何を落としたのかが見えないと、人は自分の窓を疑う。 */
export function staleReport(count: number): string | undefined {
  if (count <= 0) return undefined;
  return `前の実行が残していたブラウザを ${String(count)} 個片付けた（使い捨ての作業用。人のブラウザには触っていない）`;
}

/**
 * 置き去りを数えて落とす。**落とせなくても実行は続ける**（片付けは本筋ではない）。
 *
 * Windows では `ps` が無いので**何もしない。**
 * そこは「片付けられない」であって、「片付けた」ではない。
 */
export async function closeStaleBrowsers(
  keepDirs: readonly string[] = [],
): Promise<string | undefined> {
  if (process.platform === 'win32') return undefined;

  const listed = await run('ps', ['-Ao', 'pid,ppid,command']).then(
    (out) => out.stdout,
    () => '',
  );
  const pids = staleBrowserPids(listed, keepDirs);

  let closed = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      closed += 1;
    } catch {
      // もう居ない・権限が無い。**数に入れない**（片付けたと言わない）。
    }
  }
  return staleReport(closed);
}

/**
 * **起こしたブラウザの番号**（meta-taro/git-qa#20）。
 *
 * `close()` を辿る道だけでは足りない。同じプロセスで動いている vite も
 * 合図（`SIGINT`）を受けて終わるので、**こちらの後始末が最後まで走らない**
 * （2026-09-16 に実測。止めたのにブラウザだけ残った）。
 *
 * **待たない形が要る。**合図の中から、非同期を挟まずに落とす。
 */
const launched = new Set<number>();

export function rememberLaunched(pid: number | undefined): void {
  if (pid !== undefined && pid > 0) launched.add(pid);
}

/** 自分で閉じたものは、落としに行かない（番号は別の誰かのものになりうる）。 */
export function forgetLaunched(pid: number | undefined): void {
  if (pid !== undefined) launched.delete(pid);
}

/**
 * 覚えているものを、その場で落とす。**非同期を挟まない。**
 *
 * **1 つ落とせなくても、残りを落とす。**片付けを 1 件の失敗で止めない。
 */
export function killLaunchedSync(kill: (pid: number) => void = defaultKill): void {
  for (const pid of [...launched]) {
    launched.delete(pid);
    try {
      kill(pid);
    } catch {
      // もう居ない・権限が無い。**残りを片付ける。**
    }
  }
}

const defaultKill = (pid: number): void => {
  process.kill(pid, 'SIGTERM');
};
