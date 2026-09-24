import { runnerOf } from './release.js';
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  assertRunnableSheet,
  caseDir,
  createSheetCaseRunner,
  executeRun,
  framesToWebmCommand,
  resolveCaseResult,
  sheetDestination,
  sheetWaitMs,
  toCaseSubjects,
} from '@git-qa/core';
import type {
  Action,
  Actor,
  CaseContext,
  CaseVerdict,
  HumanAction,
  HumanInputCounts,
  HumanResult,
  HumanVerdict,
  Pointing,
  RecordingControl,
  Run,
  SheetRef,
  TargetAdapter,
  TargetSession,
  TestSpecSheet,
} from '@git-qa/core';
import { WATCH_PAUSE_MS, caseFields, parseHumanInput, watchPause } from '@git-qa/core/session';
import { DATE_FORMAT_KEY } from '@git-qa/core';
import type { HumanInput, SessionCase, SessionPhase, SessionState } from '@git-qa/core/session';
import type { LiveBridge, LiveBridgeOptions } from '@git-qa/live-bridge';

import { startLiveSession } from './live-session.js';
import { createFrameRecording, shouldRecordFrames } from './frame-recording.js';
import type { FrameRecording } from './frame-recording.js';

/** ライブ映像の枚数（橋が流す速さ）。**動画の長さを出すのに要る。** */
const LIVE_FPS = 8;
const runTool = promisify(execFile);
import { imageTools } from './image-tools.js';
import { fromInvocationDir } from './paths.js';

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
  /**
   * 証跡を書く。**置いた判定が保存されないなら、この製品は何もしていない。**
   * 書いた場所は画面へ出す。渡さなければ書かない（検査で使う）。
   */
  readonly saveRun?: (run: Run) => Promise<string>;
  /** 映像の繋ぎ直し（Issue 014）。**待たない検査のために差し替えられるようにしてある。** */
  readonly reconnect?: {
    readonly intervalMs?: number;
    readonly limitMs?: number;
    readonly sleep?: (ms: number) => Promise<void>;
  };
  /**
   * **AI が触った場所の受け取り口**（要望シート No.1）。
   *
   * アダプタは実行器より先に作られるので、直接は渡せない。
   * **知らせ先を後から預ける**形にして、輪にならないようにする。
   */
  /**
   * 証跡の置き場所。**ケースごとの画面もここへ置く。**
   * 省くと、打った場所の `runs/`。
   */
  readonly runsRoot?: string;
  readonly registerPointing?: (
    report: (at: { x: number; y: number; width?: number; height?: number; label?: string }) => void,
  ) => void;
  /**
   * **続きから**（2026-09-12・人の指示）。
   *
   * 終わっていない証跡を渡すと、**そこに在るケースは走らせずに持ち越し、
   * 残りだけを走らせて同じ 1 本に足す。**`runId` も前のものを渡すこと。
   */
  readonly previous?: Run;
  /**
   * **期待結果が出るまで待つ長さ**（外部レビュー meta-taro/git-qa#12）。
   *
   * 既定は 2 秒。**検査では小さくする** —— 落ちる判定のたびに本当に 2 秒待つと、
   * 検査そのものが待ち切れなくなる（実際にそうなった）。
   */
  readonly expectation?: { readonly waitMs?: number; readonly stepMs?: number };
  /**
   * **鑑賞モード**（2026-09-11・人の指示）。
   *
   * > 人はぼーっとみながら AI のテストを鑑賞します。……途中で止められる配慮も必要です。
   *
   * 渡すと、**人が押さなくても 1 件ごとに間をおいて進む。**
   * 押せばその判定になる。押さなければ `AUTO_PASS`（**繰り上げない**・C1）。
   */
  readonly watch?: {
    readonly pauseMs?: number;
    /** 間をおく。**検査では差し替える**（本当に 4 秒待つ理由は無い）。 */
    readonly sleep?: (ms: number) => Promise<void>;
  };
  /**
   * **録るものの差し替え。**渡さなければアダプタのもの（相手のアプリ）を使う。
   * 鑑賞モードでは **git-qa の窓**を録る（人が見たものが全部入っている）。
   */
  readonly recording?: RecordingControl;
  /**
   * **人が見ている実行でも、動画を残す**（#31 の続き・2026-09-18）。
   *
   * 録画は無人（`--no-ui --record`）だけだった。**Windows のデスクトップ検証は
   * 録画が無いまま**で、そこが最後に残った穴。**映像が通る所へ繋ぐだけ。**
   *
   * **頼まれたときだけ録る**（黙って場所を食わない）。
   * 既に録画が渡されていれば、そちらを使う（鑑賞モードは git-qa の窓を録る）。
   */
  readonly record?: boolean;
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
  typed: ReadonlyMap<number, HumanInputCounts>,
  operator: Actor,
  now: () => Date,
): Run {
  if (revised.size === 0 && touched.size === 0 && typed.size === 0) return run;
  const at = now().toISOString();

  return {
    ...run,
    cases: run.cases.map((entry) => {
      const humanResult = revised.get(entry.no);
      const actions = touched.get(entry.no);
      const counts = typed.get(entry.no);

      // **触っていないケースには足さない。**「触らずに見た」も記録のうち。
      const withActions =
        actions === undefined || actions.length === 0 ? entry : { ...entry, humanActions: actions };
      // **打っていないケースにも足さない。**0 を並べると、打った 0 回と未実施が同じ形になる。
      const withCounts =
        counts === undefined ? withActions : { ...withActions, humanInputs: counts };

      if (humanResult === undefined) return withCounts;
      return {
        ...withCounts,
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

/**
 * **期待結果を待つ長さ。シートが決める**（外部レビュー meta-taro/git-qa#39）。
 *
 * **書いていなければ既定のまま**（2 秒）。読めない書き方は `sheetWaitMs` が投げる
 * —— 黙って既定に落とすと**「8 秒待つつもりで 2 秒だった」**が起きて、気づけない（C20）。
 *
 * **呼び側が渡したものが勝つ。**検査は待ちを 0 にして走るので、そこを塞がない。
 * 実行の道では誰も渡さないので、**実際にはシートが決める。**
 *
 * **2 本ある入口の両方へ通す**（#37 —— 片方だけ直して、そちらでだけ再現しない不具合を作った）。
 */
const expectationOf = (
  meta: Record<string, string>,
  given: { readonly waitMs?: number; readonly stepMs?: number } | undefined,
): { readonly waitMs?: number; readonly stepMs?: number } | undefined => {
  const fromSheet = sheetWaitMs(meta);
  if (fromSheet === undefined) return given;
  return { waitMs: fromSheet, ...given };
};

export async function startRunSession(options: StartRunSessionOptions): Promise<RunSession> {
  // 繋ぐ前にシートを見る。繋いでから落ちると、対象を触った跡だけが残る。
  assertRunnableSheet(options.sheet);
  const subjects = toCaseSubjects(options.sheet);

  /** 絵で流れる相手のときだけ作る（下で決める）。**流れてくる絵は、ここへ渡す。** */
  let frames: FrameRecording | undefined;

  const live = await startLiveSession({
    adapter: options.adapter,
    // **映像が通るのはここ 1 か所。**録画はここで枝分かれさせる（#31）。
    onFrame: (bytes) => frames?.accept(bytes),
    ...(options.startBridge === undefined ? {} : { startBridge: options.startBridge }),
    ...(options.reconnect === undefined ? {} : { reconnect: options.reconnect }),
    onLiveError: (message) => {
      // 人へ伝える道は制御チャネルしか無い（橋は生のバイト列を流している）。
      liveError = message;
      publish();
    },
  });

  /**
   * **人が判定を置くために読むもの**も一緒に運ぶ（外部レビュー meta-taro/git-qa#19）。
   *
   * > 判定を置く人は「何をすればいいか」も「なぜそれを確かめるのか」も画面から読めません。
   *
   * 実行器は行を丸ごと持っていたのに、**`no` と `title` だけ抜き出して送っていた。**
   * 列名は決め打ちしない —— 書き手が足した列も、そのまま届く。
   */
  const columns = options.sheet.columns.map((c) => c.name);
  const cases = new Map<number, SessionCase>(
    subjects.map((s) => {
      const fields = caseFields(s.row, columns);
      return [s.no, { no: s.no, title: s.title, ...(fields.length === 0 ? {} : { fields }) }];
    }),
  );
  let phase: SessionPhase = 'running';
  let awaiting: number | undefined;
  /** 証跡を書いた場所と、書けなかった理由。**どちらも人に見せる。** */
  let runJsonPath: string | undefined;
  let saveError: string | undefined;
  /** 映像が止まった理由。**黙って真っ黒にしない。** */
  let liveError: string | undefined;
  /**
   * **触ったのに届かなかった理由**（外部レビュー meta-taro/git-qa#33）。
   *
   * 端末へ出すだけでは、**人の画面には出ない。**
   * **次に届いたら消す**（直っているのに直っていないように見せない）。
   */
  let inputError: string | undefined;
  /**
   * **AI がいま触った場所**（要望シート No.1）。
   * ケースが始まるたびに消す —— 前のケースの矢印が残っていると、人が別の所を見る。
   */
  let pointing: Pointing | undefined;
  /** 映像の実寸。**毎回は聞かない**（1 回 250 ms かかる相手がいる）。 */
  let screen: { x: number; y: number } | undefined;

  options.registerPointing?.((at) => {
    void (async () => {
      if (screen === undefined) {
        const size = await live.session.screenSize?.();
        if (size === undefined) return;
        screen = { x: size.width, y: size.height };
      }
      pointing = {
        x: at.x,
        y: at.y,
        screen,
        // **大きさも運ぶ。**矢印を、指したものの外へ置くのに要る。
        ...(at.width === undefined ? {} : { width: at.width }),
        ...(at.height === undefined ? {} : { height: at.height }),
        ...(at.label === undefined ? {} : { label: at.label }),
      };
      publish();
    })();
  });

  /** 鑑賞モードの「間」。**0 にしない**（0 だと人は何も見られない）。 */
  const pauseMs = options.watch?.pauseMs ?? WATCH_PAUSE_MS;
  const sleep =
    options.watch?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /**
   * 触った結果を、人の画面へ伝える（外部レビュー meta-taro/git-qa#33）。
   *
   * **届いたら消す。**出したままだと、直っているのに直っていないように見える
   * （映像が止まった理由と同じ扱い）。
   */
  const tellInput = (error: unknown): void => {
    const next =
      error === undefined
        ? undefined
        : error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : // **形の分からないものを、そのまま画面へ出さない**（`[object Object]` になる）。
              JSON.stringify(error);
    if (next === inputError) return;
    inputError = next;
    if (next !== undefined) console.error(`[git-qa] 人の操作を端末へ送れない: ${next}`);
    publish();
  };

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
      // **触ったのに届かなかった理由**（外部レビュー meta-taro/git-qa#33）。
      ...(inputError === undefined ? {} : { inputError }),
      ...(runJsonPath === undefined ? {} : { runJsonPath }),
      ...(saveError === undefined ? {} : { saveError }),
      ...(pointing === undefined ? {} : { pointing }),
      // **押さなくても進むことを、画面に出し続ける。**
      ...(options.watch === undefined ? {} : { watch: { pauseMs } }),
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

  /**
   * 判定まわりの打鍵回数。**手数（Issue 008 の主指標）を数えるために要る。**
   * 受け取った打鍵だけを数える —— 宛先違いで捨てたものは、人の手数ではない。
   */
  const typed = new Map<number, HumanInputCounts>();
  const countInput = (no: number, kind: 'verdict' | 'advance'): void => {
    const before = typed.get(no) ?? { verdict: 0, advance: 0 };
    typed.set(no, { ...before, [kind]: before[kind] + 1 });
  };

  let aborted: string | undefined;
  /** ケース番号ごとの「打鍵待ち」。**宛先の違う打鍵は捨てる。** */
  const waiting = new Map<number, (input: HumanInput | undefined) => void>();

  /**
   * 途中で終える。**残りは「やっていない」ではなく判断保留として残す。**
   *
   * 待っている打鍵を解く —— 解かないと、実行が終わらないまま残る。
   */
  const stop = (reason: string): void => {
    aborted = reason;
    for (const [no, resolve] of waiting) {
      waiting.delete(no);
      resolve(undefined);
    }
  };

  /** 人が触った分を、**1 つずつ順に**端末へ送るための列。 */
  let humanWork: Promise<void> = Promise.resolve();

  live.bridge.onInput((raw) => {
    const input = parseHumanInput(raw);
    if (input === undefined) return;

    /**
     * **鑑賞を止める**（2026-09-11・人の指示）。
     *
     * 見ているだけの人が止められないのは、見ているだけより悪い。
     * 待っているケース宛かどうかに関わらず受ける —— **止めたいときに止まらない**のが
     * いちばん困る。
     */
    if (input.kind === 'stop') {
      stop(`人が止めた（${String(input.caseNo)} 件目を見ているとき）`);
      return;
    }

    if (!waiting.has(input.caseNo)) {
      // 待っているケース宛でないものは、**既に走ったケースへの置き直し**としてだけ受ける。
      // まだ走っていないケースには置けない（AI が操作していないので、見て判断する材料が無い）。
      if (input.kind === 'verdict' && revise(input.caseNo, input.humanResult)) {
        countInput(input.caseNo, 'verdict');
      }
      return;
    }

    if (input.kind === 'text') {
      // **中身は証跡へ残さない**（画面には顧客名や電話番号が写る・PRD §10）。
      const at = (options.now ?? (() => new Date()))().toISOString();
      touched.set(input.caseNo, [...(touched.get(input.caseNo) ?? []), { at, kind: 'text' }]);
      void live.session
        .act({ kind: 'type', text: input.text })
        .then(() => tellInput(undefined))
        .catch((error: unknown) => tellInput(error));
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

      /**
       * **人の番のときだけ端末へ送る**（待っている＝AI の操作は終わっている）。
       * AI の操作中に人の操作が割り込むと、どちらがやったのか証跡から読めなくなる。
       *
       * **1 つずつ順に送る。**同時に走らせると、なぞる操作どうしが指の位置を奪い合う
       * （2026-09-07「ポインタが斜めにとばされるんですよね」）。
       * 送る側は「元の位置を覚えて、返す」をやっているので、
       * **前の操作が返す前に次が覚えると、覚える位置がもう動いている。**
       */
      humanWork = humanWork
        .then(async () => {
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
          tellInput(undefined);
        })
        // **握り潰さない。**端末へ出すだけでは、人の画面には出ない（#33）。
        .catch((error: unknown) => tellInput(error));
      return;
    }

    const resolve = waiting.get(input.caseNo);
    if (resolve === undefined) return;
    waiting.delete(input.caseNo);
    if (input.kind === 'verdict' || input.kind === 'advance') countInput(input.caseNo, input.kind);
    resolve(input);
  });

  /**
   * 既に走ったケースの判定を置き直す。**待っているケースは進めない**
   * （戻って直したことで、勝手に先へ行かれると人が見失う）。
   */
  const revise = (caseNo: number, humanResult: HumanResult): boolean => {
    const before = cases.get(caseNo);
    // 走っていなければ置けない。`aiResult` がその印。
    if (before?.aiResult === undefined) return false;

    revised.set(caseNo, humanResult);
    patch(caseNo, { result: humanResult, verifiedBy: options.operator.handle });
    publish();
    // **受け取ったかどうかを返す。**捨てた打鍵を手数に数えると、人が押していない分まで載る。
    return true;
  };

  /**
   * シートの見出しが宣言した行き先。「アプリを起動する」「ページを開く」の先になる。
   * **無ければその手順は保留になる。**こちらで当てにいかない。
   *
   * **`行き先` が在ればそちら、無ければ `対象`**（`sheetDestination`・#22）。
   *
   * **ここが `対象` を直に読んでいた**（外部レビュー meta-taro/git-qa#37）。
   * 無人で流す道（`headless.ts`）は `sheetDestination` を見ていたのに、
   * **人が見ている道だけが揃っていなかった。**
   * 証跡には `destination` が正しく残るのに、**手順だけが「開く先が決められない」**と言う
   * —— 書いた人からは、何が効いていないのか分からない。
   */
  const app = sheetDestination(options.sheet.meta);
  const expectation = expectationOf(options.sheet.meta, options.expectation);
  const runner = createSheetCaseRunner({
    readScreenText: options.readScreenText,
    ...(app === undefined ? {} : { app }),
    // **相手が名乗った能力をそのまま渡す。**Android の事情を全部の相手に押し付けない。
    textInput: options.adapter.capabilities.textInput,
    keyInput: options.adapter.capabilities.keyInput,
    ...(expectation === undefined ? {} : { expectation }),
    appId: options.adapter.capabilities.appId,
    // **画面の日付の書き方はシートが決める**（外部レビュー meta-taro/git-qa#29）。
    ...(options.sheet.meta[DATE_FORMAT_KEY] === undefined
      ? {}
      : { dateFormat: options.sheet.meta[DATE_FORMAT_KEY] }),
  });

  const runCase = async (ctx: CaseContext): Promise<CaseVerdict> => {
    phase = 'running';
    awaiting = undefined;
    // **前のケースの矢印を残さない。**残っていると、人が別の所を見る。
    pointing = undefined;
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

    // **鑑賞モードは「押さなければ進む」。**押すまで止まる普段の形とは逆。
    phase = options.watch === undefined ? 'waiting' : 'watching';
    awaiting = ctx.subject.no;
    publish();

    const waited = new Promise<HumanInput | undefined>((resolve) => {
      waiting.set(ctx.subject.no, resolve);
    });

    let input: HumanInput | undefined;
    if (options.watch === undefined) {
      input = await waited;
    } else {
      const outcome = await watchPause({ input: waited, pauseMs, sleep });
      // **間が過ぎたら、待ちを畳む。**残したままだと、次のケースの打鍵を横取りする。
      waiting.delete(ctx.subject.no);
      if (outcome.kind === 'placed') input = outcome.input;
      // `stopped` のときは `onInput` が既に `stop()` を呼んでいる。ここでは置かない。
    }

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

  /**
   * **録ってよい相手かを、繋いでから決める**（#31 の続き）。
   *
   * 絵で流れる相手だけ（H.264 を `.jpg` として並べると**開けない動画**が出来る）。
   * 既に録画が渡されていれば、そちらを使う —— **人が見ていたものがそのまま残る**ほうがよい。
   */
  if (
    shouldRecordFrames({
      asked: options.record === true,
      kind: live.session.liveView.transport.kind,
      already: options.recording !== undefined,
    })
  ) {
    const runsRoot = options.runsRoot ?? fromInvocationDir('runs');
    frames = createFrameRecording({
      dirFor: (caseNo) => join(caseDir(runsRoot, options.runId, caseNo), 'frames'),
      ensureDir: async (dir) => {
        await mkdir(dir, { recursive: true });
      },
      writeFrame: (path, bytes) => writeFile(path, bytes),
      toWebm: async (dir, count) => {
        const command = framesToWebmCommand(
          imageTools(),
          join(dir, '%05d.jpg'),
          join(dir, '..', 'screen.webm'),
          LIVE_FPS,
        );
        // **道具が無い。**絵は残してある（持っていない、と言う）。
        if (command === undefined) return undefined;
        await runTool(command.command, command.args);
        console.log(`[git-qa] ${String(count)} 枚を動画にした`);
        return { name: 'screen.webm' };
      },
      removeFrames: (dir) => rm(dir, { recursive: true, force: true }),
      now: () => new Date(),
      fps: LIVE_FPS,
    });
  }

  const done = executeRun({
    runId: options.runId,
    sheet: options.sheet,
    sheetRef: options.sheetRef,
    session: live.session,
    operator: options.operator,
    // **判定を出した道具の版**（残らないと、直った・直っていないの話が噛み合わない）。
    runner: runnerOf(),
    /**
     * **止めたら、そこから先は証跡に書かない**（2026-09-12）。
     *
     * 前は「止めたので BLOCKED」と書いていた。**走らせた末に判断保留になったケースと
     * 見分けが付かない**ので、続きから走らせるときに、どれをやり直すべきかが読めない。
     */
    stopped: () => aborted !== undefined,
    ...(options.previous === undefined ? {} : { previous: options.previous }),
    /**
     * **鑑賞モードは `watched`。**`assisted`（押すまで待つ）でも `auto`（誰も見ていない）
     * でもない。**人は見ているが、押さなくても進む形**だったことを、そのまま残す。
     */
    mode: options.watch === undefined ? 'assisted' : 'watched',
    /**
     * **録るものの差し替え**（鑑賞モードでは git-qa の窓を録る）。
     * 渡されていなければ、**映像の絵をそのまま溜めた録画**（#31・頼まれたときだけ）。
     */
    ...((options.recording ?? frames) === undefined
      ? {}
      : { recording: (options.recording ?? frames) as RecordingControl }),
    // **ケースごとに画面を 1 枚残す**（2026-09-11）。証跡と同じ所へ置く。
    runsRoot: options.runsRoot ?? fromInvocationDir('runs'),
    // **在れば webp にする。**無ければ撮れた形のまま（前提を増やさない・§12）。
    imageTools: imageTools(),
    // **途中経過を書けなかったら言う。**黙ると、残っていないことに気づけない。
    onProgressError: (reason) => {
      console.error('[git-qa] 途中経過を書けなかった:', reason);
    },
    runCase,
    askHuman,
    ...(options.now === undefined ? {} : { now: options.now }),
  }).then(async (run) => {
    phase = 'finished';
    awaiting = undefined;
    publish();
    // **後から置き直したものを、証跡へ反映する。**置き直せるのに残らないなら意味がない。
    const final = applyHumanTrace(
      run,
      revised,
      touched,
      typed,
      options.operator,
      options.now ?? (() => new Date()),
    );
    if (options.saveRun !== undefined) {
      try {
        runJsonPath = await options.saveRun(final);
      } catch (error: unknown) {
        // **握り潰さない。**保存できなかったことは、人が知らないと取り返せない。
        saveError = error instanceof Error ? error.message : String(error);
      }
      publish();
    }
    return final;
  });

  publish();

  return {
    liveUrl: live.liveUrl,
    controlUrl: live.bridge.controlUrl,
    done,
    abort: stop,
    close: () => live.close(),
  };
}
