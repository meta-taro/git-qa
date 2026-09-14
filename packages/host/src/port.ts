import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';

/**
 * **掴んだまま残った窓のせいで、次の実行が死ぬ**（外部レビュー meta-taro/git-qa#7）。
 *
 * > 実行を止めても vite が残り、次の実行が「Port 1420 is already in use」で死ぬ
 *
 * 実物で再現した（2026-09-13）。親を止めても、その下の `vite` は生き残る。
 *
 * ```
 * error when starting dev server:
 * Error: Port 1420 is already in use
 * ```
 *
 * **掴んでいるのが誰かは、この文言からは分からない。**
 * 別のセッションのものかもしれないし、自分が置き去りにしたものかもしれない。
 * **どちらかで、やることが変わる。**
 *
 * **後始末そのものは `killTree` が引き受ける**（2026-09-14）。
 * ここでやるのは、**それでも残ってしまったとき**（`SIGKILL`・電源・別のセッション）に、
 * **次に始めるとき何が起きているかを人に見せる**こと。**両方要る。**
 */

/**
 * 手元を指す住所。**両方を見る。**
 *
 * `vite` は **IPv6 の `[::1]`** で待ち受ける。`127.0.0.1` だけを見ていたので、
 * **掴まれているのに「空いている」と答えていた**（2026-09-13・実物で踏んだ）。
 *
 * ```
 * 掴まれている? false
 * node 72394 … TCP [::1]:1420 (LISTEN)
 * ```
 *
 * 検査は `127.0.0.1` で立てていたので通っていた。**走らせなければ出なかった。**
 */
const LOCAL_HOSTS = ['127.0.0.1', '::1'] as const;

/** その口が既に掴まれているか。**どちらかで繋がれば掴まれている。** */
export async function isPortBusy(port: number): Promise<boolean> {
  for (const host of LOCAL_HOSTS) {
    if (await connects(port, host)) return true;
  }
  return false;
}

function connects(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const done = (busy: boolean): void => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    // 繋がらない＝誰も待ち受けていない。**空いている。**
    socket.once('error', () => done(false));
  });
}

export interface ToolCall {
  readonly command: string;
  readonly args: readonly string[];
}

/** 誰が掴んでいるかを聞く道具。**聞けない OS では聞かない。** */
export function whoHoldsArgs(port: number, platform: string): ToolCall | undefined {
  if (platform === 'darwin' || platform === 'linux') {
    return { command: 'lsof', args: ['-ti', `:${String(port)}`] };
  }
  if (platform === 'win32') {
    return { command: 'netstat', args: ['-ano'] };
  }
  return undefined;
}

/** 道具の答えからプロセス番号を取る。**同じものを 2 度言わない。** */
export function parseHolders(said: string, platform: string): number[] {
  const found: number[] = [];

  for (const line of said.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    if (platform === 'win32') {
      // `netstat -ano` は表で返る。**待ち受けている行だけ**、いちばん右がプロセス番号。
      if (!trimmed.includes('LISTENING')) continue;
      const cells = trimmed.split(/\s+/);
      const pid = Number(cells[cells.length - 1]);
      if (Number.isInteger(pid) && pid > 0 && !found.includes(pid)) found.push(pid);
      continue;
    }

    const pid = Number(trimmed);
    if (Number.isInteger(pid) && pid > 0 && !found.includes(pid)) found.push(pid);
  }
  return found;
}

/**
 * 掴まれていることを、人へ伝える。
 *
 * **誰が掴んでいるかと、どうすれば空くかを、両方出す。**
 * 片方だけだと、人は「で、どうすれば」で止まる。
 */
export function busyPortMessage(
  port: number,
  holders: readonly number[],
  platform: string,
): string {
  const head = `画面の開発サーバの口（${String(port)}）が既に掴まれている。`;

  if (holders.length === 0) {
    return (
      `${head}別の git-qa が動いているか、前の実行が残しています。` +
      'そちらを閉じてから、もう一度始めてください'
    );
  }

  const list = holders.join(' ');
  const free =
    platform === 'win32'
      ? holders.map((pid) => `taskkill /PID ${String(pid)} /F`).join(' && ')
      : `kill ${list}`;

  return (
    `${head}掴んでいるのは ${list}。\n` +
    '  別の git-qa が動いているなら、そちらを閉じてください。\n' +
    `  前の実行が残したものなら、これで空きます: ${free}`
  );
}

/** いま掴んでいるものを数えて、人へ伝える文にする。**聞けなければ番号なしで言う。** */
export async function explainBusyPort(port: number, platform = process.platform): Promise<string> {
  const ask = whoHoldsArgs(port, platform);
  if (ask === undefined) return busyPortMessage(port, [], platform);

  const said = await new Promise<string>((resolve) => {
    execFile(ask.command, [...ask.args], (_error, stdout) => resolve(stdout));
  });
  const holders = parseHolders(said, platform).filter((pid) => pid !== process.pid);
  return busyPortMessage(port, holders, platform);
}
