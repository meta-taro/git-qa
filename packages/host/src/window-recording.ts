import { spawn } from 'node:child_process';

import { caseDirName } from '@git-qa/core';
import type { CaseRecording, RecordingControl } from '@git-qa/core';

/**
 * **git-qa の窓を録る**（2026-09-11・人の判断）。
 *
 * > 録画ですが、git-qa を最大化して、そのアプリを録画するとどうですか？
 *
 * 相手のアプリだけ録っても、**判定の根拠は写らない。**git-qa の窓には
 * 人が見たものが全部入っている —— ライブ映像、いまどのケースを判定していたか、
 * AI が何と言ったか、矢印がどこを指していたか。
 *
 * 録るのは外の道具（`git-qa-record`・ScreenCaptureKit）。**macOS 専用。**
 * **無くても止まらない**（録画が `unsupported` になるだけ）。
 */

/** 録っている最中の子。**止めたら、書き終わるまで待つ。** */
export interface RecordingProcess {
  /** 録り始めたことが分かるまで待つ。**始まらなければ投げる。** */
  readonly ready: Promise<void>;
  /** 止めて、**動画を書き終えるまで**待つ。 */
  stop(): Promise<void>;
}

export interface WindowRecordingDeps {
  /** 窓を録る道具の場所。**無ければ録らない。** */
  readonly recordPath: string | undefined;
  /** git-qa の窓番号。**最小化・別のデスクトップでは見つからないことがある。** */
  readonly windowId: () => Promise<number | undefined>;
  /** ケースの置き場所（絶対パス）。 */
  readonly dirFor: (caseNo: number) => string;
  /** 置き場所を作る。**録り始める前に要る**（道具は無い所へは書けない）。 */
  readonly ensureDir: (dir: string) => Promise<void>;
  readonly spawn: (command: string, args: readonly string[]) => RecordingProcess;
  /** 撮れた動画を webm にする。**できなければ撮れた形の名前が返る。** */
  readonly toWebm: (dir: string, name: string) => Promise<{ name: string; note?: string }>;
  readonly now: () => Date;
  /** webm にできなかった等、**黙りたくないこと**の行き先。 */
  readonly onNote?: (text: string) => void;
}

const MOV = 'screen.mov';

interface Running {
  readonly caseNo: number;
  readonly dir: string;
  readonly startedAt: number;
  readonly child: RecordingProcess | undefined;
  /** 始められなかった理由。**あるなら、止めたときにこれを返す。** */
  readonly failed: string | undefined;
}

export function createWindowRecording(deps: WindowRecordingDeps): RecordingControl {
  let running: Running | undefined;

  const begin = async (caseNo: number): Promise<Running> => {
    const dir = deps.dirFor(caseNo);
    const startedAt = deps.now().getTime();
    const base = { caseNo, dir, startedAt, child: undefined };

    const id = await deps.windowId();
    if (id === undefined) {
      return { ...base, failed: 'git-qa の窓が見つからない（録画は始まらなかった）' };
    }

    await deps.ensureDir(dir);
    const child = deps.spawn(deps.recordPath ?? '', [String(id), `${dir}/${MOV}`]);
    try {
      await child.ready;
    } catch (error: unknown) {
      return {
        ...base,
        failed: `録画を始められなかった: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return { ...base, child, failed: undefined };
  };

  return {
    // **道具が無いときに「録る」と言わない。**要求と結果を食い違わせない。
    requested: deps.recordPath !== undefined,

    async start(caseNo: number): Promise<void> {
      if (deps.recordPath === undefined) return;
      running = await begin(caseNo);
    },

    async stop(): Promise<CaseRecording> {
      if (deps.recordPath === undefined) {
        return { state: 'unsupported', reason: '窓を録る道具（git-qa-record）が無い' };
      }

      const current = running;
      // **2 度目は「録っていない」に戻す。**同じ動画を二重に数えない。
      running = undefined;
      if (current === undefined) return { state: 'not_requested' };
      if (current.failed !== undefined) return { state: 'failed', reason: current.failed };

      try {
        await current.child?.stop();
      } catch (error: unknown) {
        return {
          state: 'failed',
          reason: `録画を止められなかった: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      // **長さは、録り終えた時点で決まる。**この後の変換を足すと、実物と食い違う
      // （5 秒録って 6,880 ms と書いていた・2026-09-11 実測）。
      const durationMs = Math.max(0, deps.now().getTime() - current.startedAt);

      const saved = await deps.toWebm(current.dir, MOV);
      if (saved.note !== undefined) deps.onNote?.(saved.note);

      return {
        state: 'recorded',
        file: `${caseDirName(current.caseNo)}/${saved.name}`,
        durationMs,
      };
    },
  };
}

/**
 * git-qa の窓の名乗り。**2 通りある。**
 *
 * 配布物は `git-qa`（`tauri.conf.json` の `productName`）、
 * 手元で `pnpm dev` すると `git-qa-desktop`（cargo が建てた名前）。
 * **試すのは開発中の人**なので、後者で見つからないと誰も録画を試せない。
 */
export const GIT_QA_OWNERS = ['git-qa', 'git-qa-desktop'] as const;

/** git-qa の窓番号を探す。**見つからないことは起きる**（最小化・別のデスクトップ）。 */
export async function findGitQaWindow(
  look: (owner: string) => Promise<number | undefined>,
): Promise<number | undefined> {
  for (const owner of GIT_QA_OWNERS) {
    // 片方を見に行って落ちても、**もう片方を諦めない。**
    const found = await look(owner).catch(() => undefined);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 実際に `git-qa-record` を動かす。
 *
 * 道具は**録り始めたら `started` と言い、書き終えたら `ok` と言う**。
 * `started` を待たずに進むと、**頭が写らない。**
 *
 * 止め方は `SIGTERM`。**殺してはいけない。**
 * 書き終える前に切ると、moov atom の無い**開けない動画**が残る（2026-09-11 実測）。
 */
export function spawnRecorder(command: string, args: readonly string[]): RecordingProcess {
  const child = spawn(command, [...args]);

  let out = '';
  let err = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));

  const ready = new Promise<void>((resolve, reject) => {
    const check = (): void => {
      if (out.includes('started')) resolve();
    };
    child.stdout.on('data', check);
    child.on('error', (error) => reject(error));
    // **先に死んだら、始まっていない。**言い分をそのまま渡す。
    child.on('exit', () => reject(new Error(err.trim() || '録画が始まらないまま終わった')));
  });

  const ended = new Promise<void>((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `録画の道具が ${String(code)} で終わった`));
    });
  });

  return {
    ready,
    async stop(): Promise<void> {
      child.kill('SIGTERM');
      await ended;
    },
  };
}
