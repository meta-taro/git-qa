import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { readdir, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * **開いている git-qa の画面を、別のプロセスが見つける**（C120）。
 *
 * MCP（`screen`）は席ごとの別プロセスで、入口サーバの口は起動ごとに違う番号。
 * そこで入口を開いたプロセスが、ここに名乗りを 1 枚置く。閉じるときに外す。
 *
 * **置き場所はホームの下。**作業ディレクトリに置くと証跡や commit に混ざる。
 * 強く落とされると残骸が残るので、読む側は **pid が生きているか**を見て捨てる。
 */

export interface ScreenRecord {
  /** 入口サーバの URL（`http://127.0.0.1:<port>/setup/<token>`）。 */
  readonly url: string;
  readonly pid: number;
  /** その画面を開いている git-qa の名乗り（`v0.2.1` / `0.2.0-dev`）。 */
  readonly release: string;
  readonly startedAt: string;
}

export function screensDir(home: string = homedir()): string {
  return join(home, '.git-qa', 'screens');
}

/**
 * 名乗りを置く。**返ってくる関数で外す**（同期。終わり際の合図の中からも呼べる）。
 */
export function announceScreen(record: ScreenRecord, dir: string = screensDir()): () => void {
  // **自分だけが読める**（置く口の文字列が入る）。
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${String(record.pid)}.json`);
  const body: ScreenRecord = {
    url: record.url,
    pid: record.pid,
    release: record.release,
    startedAt: record.startedAt,
  };
  writeFileSync(path, JSON.stringify(body), { encoding: 'utf8', mode: 0o600 });
  return () => {
    try {
      unlinkSync(path);
    } catch {
      // 既に無い（二重に外した・人が消した）。外れていればよい。
    }
  };
}

/** そのプロセスが生きているか。**合図を送らずに聞く**（signal 0）。 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // 他人のプロセスには聞けないが、居ることは分かる。
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const isRecord = (value: unknown): value is ScreenRecord =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ScreenRecord).url === 'string' &&
  typeof (value as ScreenRecord).pid === 'number' &&
  typeof (value as ScreenRecord).release === 'string' &&
  typeof (value as ScreenRecord).startedAt === 'string';

/**
 * 開いている画面を、**新しいものから**並べて返す。
 * 死んだプロセスの名乗りと読めないファイルは、その場で捨てる。
 */
export async function findScreens(
  dir: string = screensDir(),
  isAlive: (pid: number) => boolean = pidAlive,
): Promise<ScreenRecord[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    // まだ一度も開いていない機械。**無いのは普通。**
    return [];
  }
  const found: ScreenRecord[] = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const path = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      await unlink(path).catch(() => undefined);
      continue;
    }
    if (!isRecord(parsed) || !isAlive(parsed.pid)) {
      await unlink(path).catch(() => undefined);
      continue;
    }
    found.push({
      url: parsed.url,
      pid: parsed.pid,
      release: parsed.release,
      startedAt: parsed.startedAt,
    });
  }
  return found.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

/**
 * **届かなかった名乗りを外す。**配布物では親（アプリ）が実行器を kill するので、終わり際の合図が通らず
 * 残骸が普通に残る。pid が再利用されていると生きて見えるので、繋がらなかった時点で外す。
 */
export function forgetScreen(pid: number, dir: string = screensDir()): void {
  try {
    unlinkSync(join(dir, `${String(pid)}.json`));
  } catch {
    // 既に無い。外れていればよい。
  }
}
