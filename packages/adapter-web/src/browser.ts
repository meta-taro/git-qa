import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AdapterError } from '@git-qa/core';

import { browserArgs, browserCandidates, parseActivePort, parseDevToolsUrl } from './launch.js';
import { profileNote, shouldRemoveProfile } from './profile.js';
import { STALE_MARK, closeStaleBrowsers, forgetLaunched, rememberLaunched } from './stale.js';
import type { BrowserKind } from './launch.js';

/**
 * ブラウザを起こして、繋ぎ先を返す。
 *
 * **ここは配線なので検査していない。**判断のある所（引数・繋ぎ先の読み取り）は
 * `launch.ts` にあり、そちらは検査してある。
 */

const KIND = 'web';

export interface RunningBrowser {
  readonly devToolsUrl: string;
  readonly userDataDir: string;
  /** 実際に起こしたブラウザの場所。**証跡に「何で見たか」を残すのに要る。** */
  readonly binaryPath: string;
  close(): Promise<void>;
}

export interface LaunchBrowserOptions {
  /** 使うブラウザ。省略すると、入っているものを順に探す。 */
  readonly browserPath?: string;
  /** どのブラウザで見るか。**選ばれていれば、それ以外は探さない。** */
  readonly browser?: BrowserKind;
  readonly size?: { readonly width: number; readonly height: number };
  /**
   * 片付けたことを人へ伝える口（meta-taro/git-qa#20）。
   * **黙って落とさない** —— 何を落としたのかが見えないと、人は自分の窓を疑う。
   */
  readonly onNote?: (message: string) => void;
  /**
   * ブラウザのプロファイルの置き場所（外部レビュー meta-taro/git-qa#26）。
   *
   * **渡すと、終わりに消さない。**ログインが要る画面を検証するための口で、
   * **人が一度だけ手でログインしておくためのもの。**
   * **人が普段使っているプロファイルを渡さない**（検証で触られる）。
   */
  readonly userDataDir?: string;
  /** 繋ぎ先が出てくるまで待つ上限（ms）。 */
  readonly startTimeoutMs?: number;
}

const DEFAULT_START_TIMEOUT_MS = 20_000;

/** 入っているブラウザを探す。**無ければ、どこを探したかまで言う。** */
export async function findBrowser(explicit?: string, kind?: BrowserKind): Promise<string> {
  const candidates = explicit === undefined ? browserCandidates(kind) : [explicit];
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      // 次を探す。**1 つ無いだけで止めない。**
    }
  }
  throw new AdapterError(
    KIND,
    'ブラウザが見つからない。Chrome を入れるか、使うブラウザの場所を指定する' +
      `（探した場所: ${candidates.join(' / ')}）`,
  );
}

/** 合図を送ってから、落ちたかを見るまでの間。 */
const CLOSE_GRACE_MS = 800;

export async function launchBrowser(options: LaunchBrowserOptions = {}): Promise<RunningBrowser> {
  const binary = await findBrowser(options.browserPath, options.browser);

  /**
   * **前の実行の置き去りを、先に片付ける**（meta-taro/git-qa#20）。
   *
   * 実行器を強制終了すると、ここで起こしたブラウザが残る。
   * 溜まると**人の Dock がブラウザだらけ**になる（2026-09-15 に 30 個溜めた）。
   *
   * **終わりに落とす道だけでは足りない。**`SIGKILL` では片付けが走らないので、
   * **始めるときにも見る。**落とすのは使い捨てプロファイルのものだけ ——
   * **人のブラウザには触らない。**
   */
  const cleaned = await closeStaleBrowsers();
  if (cleaned !== undefined) options.onNote?.(cleaned);
  // **用意された置き場所を使うなら、そう言う**（#26）。黙って使わない。
  const note = profileNote(options.userDataDir);
  if (note !== undefined) options.onNote?.(note);

  /**
   * **人のプロファイルを触らない。**開いているタブ・履歴・ログイン状態に手を出さない。
   *
   * **ただし、検証用の置き場所は渡せる**（外部レビュー meta-taro/git-qa#26）。
   * ログインが要る画面は、まっさらでは 1 行も流せない ——
   * **ID とパスワードをシートか環境変数に書かせることになる。**
   *
   * **渡された場所は消さない。**借りたものは返すが、**預かったものは消さない。**
   * 中に入れるものは人の領分（§14。**最初のログインは人が手で行う**）。
   */
  const userDataDir = options.userDataDir ?? (await mkdtemp(join(tmpdir(), STALE_MARK)));

  const child: ChildProcess = spawn(
    binary,
    browserArgs({
      port: 0,
      userDataDir,
      ...(options.size === undefined ? {} : { size: options.size }),
    }),
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  // **合図の中から落とせるように、番号を覚えておく**（#20）。
  rememberLaunched(child.pid);

  const close = async (): Promise<void> => {
    forgetLaunched(child.pid);
    child.kill();
    /**
     * **落ちたことを確かめる**（#20）。`kill` は合図を送るだけで、
     * 受け取った側がすぐ終わるとは限らない。残っていたら、もう一段強く言う。
     */
    await new Promise<void>((resolve) => setTimeout(resolve, CLOSE_GRACE_MS));
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // もう居ない。**片付けのために本筋を止めない。**
      }
    }
    // **こちらが作った場所だけ消す**（#26）。人の temp に溜まり続けるのは頼まれていない。
    if (shouldRemoveProfile(options.userDataDir)) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  try {
    /**
     * 繋ぎ先が出てくるのを待つ。**2 つの口を両方見る。**
     *
     * ブラウザは `DevToolsActivePort` に書き、標準エラーにも 1 行書く —— はずだが、
     * **macOS の Chrome を直に起こすと標準エラーには何も書かない**（2026-09-06 に実測）。
     * ファイルのほうが確かなので、そちらを主に見る。
     */
    const devToolsUrl = await new Promise<string>((resolve, reject) => {
      const limitMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
      const startedAt = Date.now();
      let seen = '';
      let done = false;

      const finish = (url: string): void => {
        if (done) return;
        done = true;
        clearInterval(poller);
        resolve(url);
      };

      const poller = setInterval(() => {
        void (async () => {
          if (done) return;
          const contents = await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8').catch(
            () => undefined,
          );
          const fromFile = contents === undefined ? undefined : parseActivePort(contents);
          if (fromFile !== undefined) {
            finish(fromFile);
            return;
          }
          if (Date.now() - startedAt < limitMs) return;

          done = true;
          clearInterval(poller);
          // **黙って待ち続けない。**何を待っていたのかを言う。
          reject(
            new AdapterError(
              KIND,
              `ブラウザは起きたが、繋ぎ先を言ってこない（${String(limitMs)} ms 待った）` +
                (seen.trim() === '' ? '' : `。ブラウザが言ったこと: ${seen.trim().slice(-400)}`),
            ),
          );
        })();
      }, 100);

      child.stderr?.on('data', (chunk: Buffer) => {
        seen += chunk.toString();
        const url = parseDevToolsUrl(seen);
        if (url !== undefined) finish(url);
      });

      child.on('exit', (code) => {
        if (done) return;
        done = true;
        clearInterval(poller);
        reject(
          new AdapterError(
            KIND,
            `ブラウザが起動せずに終わった（終了コード ${String(code)}）` +
              (seen.trim() === '' ? '' : `: ${seen.trim().slice(-400)}`),
          ),
        );
      });
    });

    return { devToolsUrl, userDataDir, binaryPath: binary, close };
  } catch (error) {
    // 掴んだまま投げない。**起こしたブラウザと作業場所を残さない。**
    await close();
    throw error;
  }
}
