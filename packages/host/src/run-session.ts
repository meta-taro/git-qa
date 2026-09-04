import {
  assertRunnableSheet,
  createSheetCaseRunner,
  executeRun,
  resolveCaseResult,
  toCaseSubjects,
} from '@git-qa/core';
import type {
  Action,
  Actor,
  HumanAction,
  HumanResult,
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
  /** 画面へ渡すシートの場所。**人が開くための道** なので、絶対パスが望ましい。 */
  readonly sheetPath?: string;
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

/**
 * 後から置き直された判定と、人が触った操作を `run.json` へ反映する。
 *
 * **置き直した人と時刻は、最後の 1 回のもの。**途中経過は残さない（残すなら形を別に決める）。
 */
function applyHumanTrace(
  run: Run,
  revised: ReadonlyMap<number, HumanResult>,
  touched: ReadonlyMap<number, HumanAction[]>,
  operator: Actor,
  now: () => Date,
): Run {
  if (revised.size === 0 && touched.size === 0) return run;
  const at = now().toISOString();

  return {
    ...run,
    cases: run.cases.map((entry) => {
      const humanResult = revised.get(entry.no);
      const actions = touched.get(entry.no);

      // **触っていないケースには足さない。**「触らずに見た」も記録のうち。
      const withActions =
        actions === undefined || actions.length === 0 ? entry : { ...entry, humanActions: actions };

      if (humanResult === undefined) return withActions;
      return {
        ...withActions,
        humanResult,
        result: resolveCaseResult({
          ...(entry.aiResult === undefined ? {} : { aiResult: entry.aiResult }),
          humanResult,
        }),
        verifiedBy: operator.handle,
        verifiedAt: at,
      };
    }),
  };
}

export async function startRunSession(options: StartRunSessionOptions): Promise<RunSession> {
  // 繋ぐ前にシートを見る。繋いでから落ちると、対象を触った跡だけが残る。
  assertRunnableSheet(options.sheet);
  const subjects = toCaseSubjects(options.sheet);

  const live = await startLiveSession({
    adapter: options.adapter,
    ...(options.startBridge === undefined ? {} : { startBridge: options.startBridge }),
    onLiveError: (message) => {
      // 人へ伝える道は制御チャネルしか無い（橋は生のバイト列を流している）。
      liveError = message;
      publish();
    },
  });

  const cases = new Map<number, SessionCase>(
    subjects.map((s) => [s.no, { no: s.no, title: s.title }]),
  );
  let phase: SessionPhase = 'running';
  let awaiting: number | undefined;
  /** 映像が止まった理由。**黙って真っ黒にしない。** */
  let liveError: string | undefined;

  const publish = (): void => {
    const state: SessionState = {
      runId: options.runId,
      phase,
      ...(awaiting === undefined ? {} : { awaiting }),
      // 画面のメニューから開けるように、シートの場所を渡す（画面は Node のファイルを見られない）。
      ...(options.sheetPath === undefined
        ? { sheetPath: options.sheetRef.path }
        : { sheetPath: options.sheetPath }),
      ...(liveError === undefined ? {} : { liveError }),
      cases: [...cases.values()],
    };
    live.bridge.publish(state);
  };

  const patch = (no: number, fields: Partial<SessionCase>): void => {
    const before = cases.get(no);
    if (before === undefined) return;
    cases.set(no, { ...before, ...fields });
  };

  /**
   * 後から置き直された判定。**押し間違いは起きるし、見落としにも後から気づく。**
   * 実行が終わったときに `run.json` へ反映する。
   */
  const revised = new Map<number, HumanResult>();

  /**
   * 人が自分で触った操作。**AI の足跡とは別に残す。**
   * これが無いと「本当に人が見たのか」が証跡から読めない。
   */
  const touched = new Map<number, HumanAction[]>();

  let aborted: string | undefined;
  /** ケース番号ごとの「打鍵待ち」。**宛先の違う打鍵は捨てる。** */
  const waiting = new Map<number, (input: HumanInput | undefined) => void>();

  live.bridge.onInput((raw) => {
    const input = parseHumanInput(raw);
    if (input === undefined) return;

    if (!waiting.has(input.caseNo)) {
      // 待っているケース宛でないものは、**既に走ったケースへの置き直し**としてだけ受ける。
      // まだ走っていないケースには置けない（AI が操作していないので、見て判断する材料が無い）。
      if (input.kind === 'verdict') revise(input.caseNo, input.humanResult);
      return;
    }

    if (input.kind === 'text') {
      // **中身は証跡へ残さない**（画面には顧客名や電話番号が写る・PRD §10）。
      const at = (options.now ?? (() => new Date()))().toISOString();
      touched.set(input.caseNo, [...(touched.get(input.caseNo) ?? []), { at, kind: 'text' }]);
      void live.session.act({ kind: 'type', text: input.text }).catch((error: unknown) => {
        console.error('[git-qa] 人の操作を端末へ送れない', error);
      });
      return;
    }

    if (input.kind === 'tap' || input.kind === 'swipe' || input.kind === 'longPress') {
      // **映像は端末より小さく流している。**送られてきた座標を実寸へ戻さないと、
      // 違う所を触る（実機で押しても反応しなかった）。
      const scale = async (x: number, y: number): Promise<{ x: number; y: number }> => {
        const screen = input.screen;
        const size = await live.session.screenSize?.();
        if (screen === undefined || size === undefined || screen.x <= 0 || screen.y <= 0) {
          return { x, y };
        }
        return {
          x: Math.round((x * size.width) / screen.x),
          y: Math.round((y * size.height) / screen.y),
        };
      };

      // **人の番のときだけ端末へ送る**（待っている＝AI の操作は終わっている）。
      // AI の操作中に人の操作が割り込むと、どちらがやったのか証跡から読めなくなる。
      void (async () => {
        const at = (options.now ?? (() => new Date()))().toISOString();
        let action: Action;
        let record: HumanAction;

        if (input.kind === 'tap') {
          const to = await scale(input.x, input.y);
          action = { kind: 'tap', target: { at: 'point', ...to } };
          record = { at, kind: 'tap', to };
        } else if (input.kind === 'longPress') {
          // **端末に「長押し」という命令は無い。**同じ場所へ時間をかけてなぞると長押しになる。
          const to = await scale(input.x, input.y);
          action = {
            kind: 'swipe',
            from: { at: 'point', ...to },
            to: { at: 'point', ...to },
            durationMs: input.durationMs,
          };
          record = { at, kind: 'longPress', to };
        } else {
          const from = await scale(input.from.x, input.from.y);
          const to = await scale(input.to.x, input.to.y);
          action = {
            kind: 'swipe',
            from: { at: 'point', ...from },
            to: { at: 'point', ...to },
            durationMs: input.durationMs,
          };
          record = { at, kind: 'swipe', from, to };
        }

        // **端末の実寸で残す。**画面に映していた大きさではなく、実際に触った位置。
        touched.set(input.caseNo, [...(touched.get(input.caseNo) ?? []), record]);
        await live.session.act(action);
      })().catch((error: unknown) => {
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

  /**
   * 既に走ったケースの判定を置き直す。**待っているケースは進めない**
   * （戻って直したことで、勝手に先へ行かれると人が見失う）。
   */
  const revise = (caseNo: number, humanResult: HumanResult): void => {
    const before = cases.get(caseNo);
    // 走っていなければ置けない。`aiResult` がその印。
    if (before?.aiResult === undefined) return;

    revised.set(caseNo, humanResult);
    patch(caseNo, { result: humanResult, verifiedBy: options.operator.handle });
    publish();
  };

  // シートの見出しが宣言した対象アプリ。「アプリを起動する」の行き先になる。
  // **無ければその手順は保留になる。**こちらで当てにいかない。
  const app = options.sheet.meta['対象'];
  const runner = createSheetCaseRunner({
    readScreenText: options.readScreenText,
    ...(app === undefined ? {} : { app }),
  });

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
    // **後から置き直したものを、証跡へ反映する。**置き直せるのに残らないなら意味がない。
    return applyHumanTrace(
      run,
      revised,
      touched,
      options.operator,
      options.now ?? (() => new Date()),
    );
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
