import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AdapterError } from '@git-qa/core';

import { BROWSER_CANDIDATES, browserArgs, parseActivePort, parseDevToolsUrl } from './launch.js';

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
  close(): Promise<void>;
}

export interface LaunchBrowserOptions {
  /** 使うブラウザ。省略すると、入っているものを順に探す。 */
  readonly browserPath?: string;
  readonly size?: { readonly width: number; readonly height: number };
  /** 繋ぎ先が出てくるまで待つ上限（ms）。 */
  readonly startTimeoutMs?: number;
}

const DEFAULT_START_TIMEOUT_MS = 20_000;

/** 入っているブラウザを探す。**無ければ、どこを探したかまで言う。** */
export async function findBrowser(explicit?: string): Promise<string> {
  const candidates = explicit === undefined ? BROWSER_CANDIDATES : [explicit];
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

export async function launchBrowser(options: LaunchBrowserOptions = {}): Promise<RunningBrowser> {
  const binary = await findBrowser(options.browserPath);
  // **人のプロファイルを触らない。**開いているタブ・履歴・ログイン状態に手を出さない。
  const userDataDir = await mkdtemp(join(tmpdir(), 'git-qa-web-'));

  const child: ChildProcess = spawn(
    binary,
    browserArgs({
      port: 0,
      userDataDir,
      ...(options.size === undefined ? {} : { size: options.size }),
    }),
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const close = async (): Promise<void> => {
    child.kill();
    // 作業場所は残さない。**人の temp に溜まり続けるのは、頼まれていない。**
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
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

    return { devToolsUrl, userDataDir, close };
  } catch (error) {
    // 掴んだまま投げない。**起こしたブラウザと作業場所を残さない。**
    await close();
    throw error;
  }
}
