import {
  assertRunnableSheet,
  createSheetCaseRunner,
  executeRun,
  toCaseSubjects,
} from '@git-qa/core';
import type {
  Actor,
  CaseContext,
  CaseVerdict,
  HumanVerdict,
  Run,
  SheetRef,
  TargetAdapter,
  TargetSession,
  TestSpecSheet,
} from '@git-qa/core';
import { parseHumanInput } from '@git-qa/core/session';
import type { HumanInput, SessionCase, SessionPhase, SessionState } from '@git-qa/core/session';
import type { LiveBridge, LiveBridgeOptions } from '@git-qa/live-bridge';

import { startLiveSession } from './live-session.js';

/**
 * 一本道 — シートを読む → 端末を操作する → **人が 1 打鍵で置く** → `run.json` の中身が出る。
 *
 * **人が押すまで次のケースへ進まない**（Issue 004 の「ケース間の遷移」）。時間で勝手に
 * 進めると、人が見ようとしていたケースを見逃したまま `AUTO_PASS` が積み上がる。
 * 誰も見ない実行が要るなら、それは `mode: 'auto'`（`executeRun` を直に呼ぶ）の仕事。
 */

export interface StartRunSessionOptions {
  readonly adapter: TargetAdapter;
  readonly sheet: TestSpecSheet;
  readonly sheetRef: SheetRef;
  readonly runId: string;
  readonly operator: Actor;
  /** 画面から読める文字を取る。対象ごとに違うのでコアは知らない（C8）。 */
  readonly readScreenText: (session: TargetSession) => Promise<string>;
  readonly startBridge?: (options: LiveBridgeOptions) => Promise<LiveBridge>;
  readonly now?: () => Date;
}

export interface RunSession {
  /** 画面が読む映像の URL（`?live=`）。 */
  readonly liveUrl: string;
  /** 画面が状態を読み、打鍵を返す URL（`?control=`）。 */
  readonly controlUrl: string;
  /** 実行が終わると `run.json` の中身が返る。 */
  readonly done: Promise<Run>;
  /** 途中で終える。**残りは「やっていない」ではなく判断保留として残す。** */
  abort(reason: string): void;
  close(): Promise<void>;
}

export async function startRunSession(options: StartRunSessionOptions): Promise<RunSession> {
  // 繋ぐ前にシートを見る。繋いでから落ちると、対象を触った跡だけが残る。
  assertRunnableSheet(options.sheet);
  const subjects = toCaseSubjects(options.sheet);

  const live = await startLiveSession({
    adapter: options.adapter,
    ...(options.startBridge === undefined ? {} : { startBridge: options.startBridge }),
  });

  const cases = new Map<number, SessionCase>(
    subjects.map((s) => [s.no, { no: s.no, title: s.title }]),
  );
  let phase: SessionPhase = 'running';
  let awaiting: number | undefined;

  const publish = (): void => {
    const state: SessionState = {
      runId: options.runId,
      phase,
      ...(awaiting === undefined ? {} : { awaiting }),
      cases: [...cases.values()],
    };
    live.bridge.publish(state);
  };

  const patch = (no: number, fields: Partial<SessionCase>): void => {
    const before = cases.get(no);
    if (before === undefined) return;
    cases.set(no, { ...before, ...fields });
  };

  let aborted: string | undefined;
  /** ケース番号ごとの「打鍵待ち」。**宛先の違う打鍵は捨てる。** */
  const waiting = new Map<number, (input: HumanInput | undefined) => void>();

  live.bridge.onInput((raw) => {
    const input = parseHumanInput(raw);
    if (input === undefined) return;

    // 待っているケース宛でなければ捨てる。
    // **遅れて届いた打鍵が、次のケースに付くのが一番まずい。**
    if (!waiting.has(input.caseNo)) return;

    if (input.kind === 'tap') {
      // **人の番のときだけ端末へ送る**（待っている＝AI の操作は終わっている）。
      // AI の操作中に人の操作が割り込むと、どちらがやったのか証跡から読めなくなる。
      void live.session
        .act({ kind: 'tap', target: { at: 'point', x: input.x, y: input.y } })
        .catch((error: unknown) => {
          // 握り潰さない。触ったのに何も起きない理由が、人に見えなくなる。
          console.error('[git-qa] 人の操作を端末へ送れない', error);
        });
      return;
    }

    const resolve = waiting.get(input.caseNo);
    if (resolve === undefined) return;
    waiting.delete(input.caseNo);
    resolve(input);
  });

  const runner = createSheetCaseRunner({ readScreenText: options.readScreenText });

  const runCase = async (ctx: CaseContext): Promise<CaseVerdict> => {
    if (aborted !== undefined) {
      // 走らせなかったことを「通った」にしない。
      return { aiResult: 'BLOCKED', note: `実行を途中で終えた: ${aborted}` };
    }
    phase = 'running';
    awaiting = undefined;
    publish();

    const verdict = await runner(ctx);
    patch(ctx.subject.no, {
      aiResult: verdict.aiResult,
      ...(verdict.note === undefined ? {} : { note: verdict.note }),
    });
    return verdict;
  };

  const askHuman = async (
    ctx: CaseContext,
    verdict: CaseVerdict,
  ): Promise<HumanVerdict | undefined> => {
    if (aborted !== undefined) return undefined;

    phase = 'waiting';
    awaiting = ctx.subject.no;
    publish();

    const input = await new Promise<HumanInput | undefined>((resolve) => {
      waiting.set(ctx.subject.no, resolve);
    });

    awaiting = undefined;
    // tap はここへ来ない（`onInput` で処理して待ち続ける）。**型の上でも判定だけに絞る。**
    if (input === undefined || input.kind !== 'verdict') {
      // 置かずに送られた。**繰り上げない**ので `AUTO_PASS` になる（C1）。
      patch(ctx.subject.no, {
        result: verdict.aiResult === 'PASS' ? 'AUTO_PASS' : verdict.aiResult,
      });
      publish();
      return undefined;
    }

    patch(ctx.subject.no, { result: input.humanResult, verifiedBy: options.operator.handle });
    publish();
    return { humanResult: input.humanResult, by: options.operator.handle };
  };

  const done = executeRun({
    runId: options.runId,
    sheet: options.sheet,
    sheetRef: options.sheetRef,
    session: live.session,
    operator: options.operator,
    mode: 'assisted',
    runCase,
    askHuman,
    ...(options.now === undefined ? {} : { now: options.now }),
  }).then((run) => {
    phase = 'finished';
    awaiting = undefined;
    publish();
    return run;
  });

  publish();

  return {
    liveUrl: live.liveUrl,
    controlUrl: live.bridge.controlUrl,
    done,
    abort(reason: string): void {
      aborted = reason;
      // 待っている打鍵を解く。解かないと、実行が終わらないまま残る。
      for (const [no, resolve] of waiting) {
        waiting.delete(no);
        resolve(undefined);
      }
    },
    close: () => live.close(),
  };
}
