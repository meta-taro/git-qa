import type { RecordingControl, TargetAdapter, TargetSession } from '../adapter/types.js';
import type { ImageTools } from '../adapter/to-webp.js';
import { captureCaseShot } from './case-shot.js';
import { saveRunProgress } from './save-progress.js';
import { compareFingerprint } from './target-check.js';
import { resolveCaseResult } from './result.js';
import type {
  Actor,
  AiResult,
  CaseRecording,
  Finding,
  HumanResult,
  Run,
  RunCase,
  RunMode,
  RunStep,
  SheetRef,
} from './types.js';
import { RUN_SCHEMA_VERSION } from './types.js';
import type { TestSpecSheet, TsvRow } from '../tsv/types.js';

/**
 * 検証シートを 1 本走らせて `run.json` の中身を作る。
 *
 * ここが決めるのは**順番と記録**だけ。何をどう操作するかは呼び出し側（`runCase`）、
 * 対象への繋ぎ方はアダプタ、人の判断は `askHuman` が持つ。
 *
 * **結果はこの戻り値にしか書かない。**検証シート TSV へは書き戻さない（decisions.md C3）。
 */

/** 検証シートの列名。テンプレートは全リポ共通なので、ここに固定で持つ。 */
export const CASE_NO_COLUMN = 'No.';
export const CASE_TITLE_COLUMN = '項目';

/** シートの 1 行を、走らせる 1 件として見たもの。 */
export interface CaseSubject {
  no: number;
  title: string;
  /** 手順・期待結果は行ごと渡す。どの列をどう読むかは呼び出し側が決める。 */
  row: TsvRow;
}

export interface CaseContext {
  readonly subject: CaseSubject;
  readonly session: TargetSession;
  /** 動画の頭出しに使う足跡を 1 つ置く。 */
  readonly step: (label?: string) => void;
}

/** AI が出す判定。`VERIFIED` は型として書けない（C17）。 */
export interface CaseVerdict {
  aiResult: AiResult;
  note?: string;
}

/** 人が出す判定。`AUTO_PASS` は型として書けない（C17）。 */
export interface HumanVerdict {
  humanResult: HumanResult;
  /** 名前を置いた人。個人名ではなくハンドル。 */
  by: string;
  note?: string;
}

export interface ExecuteRunOptions {
  runId: string;
  sheet: TestSpecSheet;
  /** 読んだシートの出どころ。ハッシュは読み込んだ側が持っている。 */
  sheetRef: SheetRef;
  /** ここで繋ぐ場合。**{@link ExecuteRunOptions.session} とはどちらか一方。** */
  adapter?: TargetAdapter;
  /**
   * 既に繋いであるセッション。**宿主は映像を出すために先に繋いでいる**ので、
   * ここで繋ぎ直すと端末を二重に掴む。渡された場合は**閉じない**（持ち主が閉じる）。
   */
  session?: TargetSession;
  operator: Actor;
  mode: RunMode;
  /** ケース 1 件を実際に動かす。操作は `ctx.session` 経由。 */
  runCase: (ctx: CaseContext) => Promise<CaseVerdict>;
  /**
   * 人に結果を置いてもらう。`undefined` が返ったら**人は見ていない**ということで、
   * `AUTO_PASS` になる。繰り上げない。
   */
  askHuman?: (ctx: CaseContext, verdict: CaseVerdict) => Promise<HumanVerdict | undefined>;
  /**
   * 証跡の置き場所。**渡すと、ケースごとに画面を 1 枚残す。**
   * 渡さなければ撮らない（`screenshot.state` が `not_requested` になる）。
   */
  runsRoot?: string;
  /**
   * 絵を webp にする道具の場所。**無ければ、撮れた形のまま置く**（2026-09-11）。
   * 前提を増やさないため、**在れば使う**形にしてある。
   */
  imageTools?: ImageTools;
  /**
   * **録るものを差し替える**（2026-09-11・人の判断）。
   *
   * > 録画ですが、git-qa を最大化して、そのアプリを録画するとどうですか？
   *
   * アダプタが持っている録画は**相手のアプリ**を録る。人が見たいのは
   * **git-qa の窓**（ライブ映像・いま何を判定しているか・AI の言い分・矢印が全部入る）。
   *
   * **相手を録る口は消さない。**Android では相手を録るのが正しい。
   */
  recording?: RecordingControl;
  /**
   * **ここで止めてくれ**（2026-09-12）。次のケースへ行く前に聞く。
   *
   * 止めたケースを「走らせた末に判断保留」として書かない —— **走らせていないものは、
   * 証跡に書かない。**書くと、続きから走らせるときに**どれをやり直すべきかが読めない。**
   */
  stopped?: () => boolean;
  /**
   * **続きから**（2026-09-12・人の指示）。
   *
   * > それは途中までテストして、落として、次の日検証を再開しても大丈夫ですかね
   *
   * 前の（終わっていない）証跡を渡すと、**そこに在るケースは走らせずに持ち越し、
   * 残りだけを走らせて同じ 1 本に足す。**新しい実行にすると証跡が 2 本に割れ、
   * 読む人が突き合わせることになる。
   *
   * **始めた時刻も前のもの。**続きだからといって、今日始めたことにしない。
   */
  previous?: Run;
  /** 途中経過を書けなかったときの理由。**黙らない**ためだけに使う。 */
  onProgressError?: (reason: string) => void;
  /** 時刻の出どころ。既定は実時計。 */
  now?: () => Date;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const joinNotes = (...notes: (string | undefined)[]): string | undefined => {
  const kept = notes.filter((n): n is string => n !== undefined && n !== '');
  return kept.length === 0 ? undefined : kept.join('\n');
};

/**
 * 走らせる前にシートを読み切る。**繋いでから落ちると、対象を触った跡だけが残る。**
 */
export function toCaseSubjects(sheet: TestSpecSheet): CaseSubject[] {
  const names = sheet.columns.map((c) => c.name);
  for (const required of [CASE_NO_COLUMN, CASE_TITLE_COLUMN]) {
    if (!names.includes(required)) {
      throw new Error(`検証シートに「${required}」列が無い（列: ${names.join(' / ')}）`);
    }
  }

  const subjects: CaseSubject[] = [];
  const seen = new Map<number, number>();
  for (const row of sheet.rows) {
    const raw = row.cells[CASE_NO_COLUMN] ?? '';
    const no = Number(raw);
    if (!Number.isInteger(no) || no < 1) {
      throw new Error(`${row.line} 行目の No. が 1 以上の整数でない: ${JSON.stringify(raw)}`);
    }
    const first = seen.get(no);
    if (first !== undefined) {
      // ケースの置き場所が `case-001` のように No. で決まるので、重複すると証跡が上書きされる。
      throw new Error(`No. ${no} が ${first} 行目と ${row.line} 行目で重複している`);
    }
    seen.set(no, row.line);

    const title = (row.cells[CASE_TITLE_COLUMN] ?? '').trim();
    if (title === '') {
      throw new Error(`${row.line} 行目の「${CASE_TITLE_COLUMN}」が空`);
    }
    subjects.push({ no, title, row });
  }
  return subjects;
}

/** 設定同士の食い違いは、走らせる前に落とす。走ってからでは実行が 1 本無駄になる。 */
function assertModeMatchesAskHuman(mode: RunMode, hasAskHuman: boolean): void {
  if (mode === 'auto' && hasAskHuman) {
    throw new Error('mode が auto の実行では askHuman を渡せない（誰も見ない実行のはずなので）');
  }
  if (mode !== 'auto' && !hasAskHuman) {
    throw new Error(
      `mode が ${mode} の実行には askHuman が要る（無いと全ケースが AUTO_PASS になる）`,
    );
  }
}

async function stopRecording(recording: RecordingControl): Promise<CaseRecording> {
  try {
    return await recording.stop();
  } catch (error: unknown) {
    // 録画の後始末が失敗しても、ケースの合否は落とさない。**黙って握らず、理由を残す。**
    return { state: 'failed', reason: errorMessage(error) };
  }
}

async function runOneCase(
  subject: CaseSubject,
  session: TargetSession,
  options: ExecuteRunOptions,
  now: () => Date,
): Promise<RunCase> {
  const steps: RunStep[] = [];
  const ctx: CaseContext = {
    subject,
    session,
    step: (label?: string): void => {
      const at = now().toISOString();
      steps.push(
        label === undefined ? { index: steps.length, at } : { index: steps.length, at, label },
      );
    },
  };

  const startedAt = now().toISOString();
  const recorder = options.recording ?? session.recording;
  if (recorder.requested) {
    await recorder.start(subject.no);
  }

  let verdict: CaseVerdict;
  try {
    verdict = await options.runCase(ctx);
  } catch (error: unknown) {
    // 1 件落ちても実行ごと止めない。止めると、残りのケースが「やっていない」ことすら残らない。
    verdict = { aiResult: 'FAIL', note: errorMessage(error) };
  }

  // 録画はケースの操作までで閉じる。人が考えている時間は動画に入れない。
  const recording = await stopRecording(recorder);

  /**
   * **判定を置く時点の画面を残す**（2026-09-11）。
   *
   * 人へ渡す前に撮る —— 人が考えている間に画面が動くと、
   * **「人が見たもの」と「残った絵」がずれる。**
   */
  const screenshot = await captureCaseShot({
    session,
    ...(options.runsRoot === undefined ? {} : { runsRoot: options.runsRoot }),
    ...(options.imageTools === undefined ? {} : { tools: options.imageTools }),
    runId: options.runId,
    caseNo: subject.no,
  });

  const human = await options.askHuman?.(ctx, verdict);

  const finishedAt = now().toISOString();
  const result = resolveCaseResult(
    human === undefined
      ? { aiResult: verdict.aiResult }
      : { aiResult: verdict.aiResult, humanResult: human.humanResult },
  );
  const note = joinNotes(verdict.note, human?.note);

  return {
    no: subject.no,
    title: subject.title,
    startedAt,
    finishedAt,
    aiResult: verdict.aiResult,
    ...(human === undefined
      ? {}
      : { humanResult: human.humanResult, verifiedBy: human.by, verifiedAt: finishedAt }),
    result,
    steps,
    recording,
    screenshot,
    ...(note === undefined ? {} : { note }),
  };
}

/** 繋ぐ相手は 1 つ。**両方渡されたら、どちらで走ったのか証跡から読めなくなる。** */
function assertOneTarget(options: ExecuteRunOptions): void {
  const given = [options.adapter, options.session].filter((v) => v !== undefined).length;
  if (given !== 1) {
    throw new Error('adapter と session のどちらか一方を渡すこと');
  }
}

export async function executeRun(options: ExecuteRunOptions): Promise<Run> {
  const now = options.now ?? ((): Date => new Date());
  assertOneTarget(options);
  assertModeMatchesAskHuman(options.mode, options.askHuman !== undefined);
  const subjects = toCaseSubjects(options.sheet);

  // **続きなら、始まりは前のまま。**今日始めたことにしない。
  const startedAt = options.previous?.startedAt ?? now().toISOString();
  // 渡されたセッションは、ここで開け閉めしない。**持ち主が開けて、持ち主が閉じる。**
  const borrowed = options.session;
  const session = borrowed ?? (await (options.adapter as TargetAdapter).connect());
  // **昨日の分をそのまま持ち越す。**置き直させない。
  const cases: RunCase[] = [...(options.previous?.cases ?? [])];
  const alreadyRan = new Set(cases.map((one) => one.no));
  const findings: Finding[] = [...(options.previous?.findings ?? [])];
  /** 途中で止めたか。**止めた実行には終わりの時刻を押さない**（それが「途中」の印）。 */
  let stopped = false;

  /** **いまの時点の証跡。**途中経過にも、最後にも、同じ形を使う。 */
  /**
   * **相手が走行中に入れ替わっていないかを測る**（外部レビュー meta-taro/git-qa#3）。
   *
   * 測れない相手は `undefined`。**測れなかったことを、測った結果に混ぜない。**
   * 測る途中で投げられても、実行は止めない（証跡のための測りで、検証そのものではない）。
   */
  const fingerprint = async (): Promise<string | undefined> => {
    try {
      return await session.fingerprint?.();
    } catch {
      return undefined;
    }
  };

  const before = await fingerprint();
  // 1 件終わるたびに測り直す。**途中経過の証跡にも、そこまでの結果が入る。**
  let after = before;

  /**
   * いまの時点の証跡。
   *
   * **`finishedAt` は走り切ったときにだけ押す。**「**無いことが『途中で止まった』の
   * 記録になる**」という約束で作ってある（`types.ts`）。
   *
   * 途中経過にも押していた時期がある（2026-09-11）。そのときは、
   * **落ちた実行の証跡を翌日に開いても、走り切ったものと見分けが付かなかった。**
   * 証跡が残ること（外部レビュー #2）と、**残った証跡が何なのかが読めること**は別の話。
   */
  const assemble = (finished: boolean): Run => ({
    schemaVersion: RUN_SCHEMA_VERSION,
    runId: options.runId,
    startedAt,
    ...(finished ? { finishedAt: now().toISOString() } : {}),
    operator: options.operator,
    mode: options.mode,
    sheet: options.sheetRef,
    target: session.target,
    targetCheck: compareFingerprint(before, after),
    recording: { requested: (options.recording ?? session.recording).requested },
    cases,
    findings,
  });

  try {
    // 人が横で見られる状態にしてから走らせる（C4）。開けずに走ると、見る先が無い。
    if (borrowed === undefined) await session.liveView.open();
    for (const subject of subjects) {
      // 昨日やった分は走らせない。
      if (alreadyRan.has(subject.no)) continue;
      // **止めてくれと言われたら、ここで終わる。**走らせていないものを証跡に書かない。
      if (options.stopped?.() === true) {
        stopped = true;
        break;
      }

      cases.push(await runOneCase(subject, session, options, now));
      after = await fingerprint();

      /**
       * **1 件終わるたびに書く**（外部レビュー meta-taro/git-qa#2）。
       *
       * 証跡を最後に 1 回だけ書いていたので、**途中で落ちると人が置いた判定が全部消えた。**
       * signal を拾う道は、この道具では効かない（CLI は `vite-node` の下で走り、
       * **signal がスクリプトまで来ない**・実測）。**落ち方を選ばない方法はこれだけ。**
       *
       * **書けなくても実行は続ける。**途中経過が残せないことを理由に、
       * 人が置いている最中の実行を止めない。
       */
      if (options.runsRoot !== undefined) {
        await saveRunProgress(options.runsRoot, assemble(false)).catch((error: unknown) => {
          options.onProgressError?.(errorMessage(error));
        });
      }
    }
  } finally {
    if (borrowed === undefined) await session.close();
  }

  const run = assemble(!stopped);
  // **最後にもう一度書く。**途中経過の最後の 1 枚は「まだ終わっていない」形なので、
  // ここで押し直さないと、**走り切った実行がファイル上では途中に見える。**
  if (options.runsRoot !== undefined) {
    await saveRunProgress(options.runsRoot, run).catch((error: unknown) => {
      options.onProgressError?.(errorMessage(error));
    });
  }
  return run;
}
