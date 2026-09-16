import { AI_RESULTS, CASE_RESULTS, HUMAN_RESULTS } from '../run/types.js';
import type { AiResult, CaseResult, HumanResult } from '../run/types.js';

/**
 * 画面（webview）と実行器（Node）の間でやりとりする形。**両側の正本はここ。**
 *
 * 橋（`@git-qa/live-bridge`）は中身を知らずに運ぶので、**受け取る側が必ず検証する。**
 * 形の違うものを黙って受け取ると、`run.json` に人が置いていない判定が入りうる。
 */

/**
 * シートに書いてある 1 欄（外部レビュー meta-taro/git-qa#19）。
 *
 * **列名は決め打ちしない。**`No.` と `項目` 以外を、**書いた人の言葉のまま**運ぶ。
 * 決め打ちにすると、書き手が足した「なぜ見るのか」のような列が届かない。
 */
export interface SessionField {
  readonly label: string;
  readonly value: string;
}

/** 画面に出ている 1 ケース。 */
export interface SessionCase {
  readonly no: number;
  readonly title: string;
  /**
   * **人が判定を置くために読むもの**（手順・期待結果・書き手が足した列）。
   *
   * > 署名する人が、何を確かめているのか画面から読めない。
   *
   * 運んでいなかったので、判定カラムには**見出しと AI の但し書きしか出ていなかった。**
   * **人が主で、AI の但し書きは脇。**
   */
  readonly fields?: readonly SessionField[];
  /** AI が出した判定。まだ走っていないケースは持たない。 */
  readonly aiResult?: AiResult;
  /** 確定した最終結果。人が置くか、実行が次へ進んだ時点で決まる。 */
  readonly result?: CaseResult;
  readonly verifiedBy?: string;
  readonly note?: string;
}

/** `running` = AI が操作中 / `waiting` = 人の打鍵待ち / `finished` = 実行が終わった */
/**
 * `'watching'` は**鑑賞モード**（2026-09-11・人の指示）。
 *
 * > 人はぼーっとみながら AI のテストを鑑賞します。
 *
 * `'waiting'` との違いは、**人が押さなくても先へ進む**こと。
 * 押せば置ける（見ていた人の判定になる）が、押さなければ `AUTO_PASS`。
 * **繰り上げない**（C1）。
 */
export type SessionPhase = 'running' | 'waiting' | 'watching' | 'finished';

export interface SessionState {
  readonly runId: string;
  readonly phase: SessionPhase;
  /**
   * 走らせている検証シートの場所。**画面のメニューから開くために要る**（Issue 011）。
   * 画面は Node 側のファイルを直接は見られないので、ここで渡す。
   */
  readonly sheetPath?: string;
  /**
   * 映像が止まった理由。**黙って真っ黒にしない。**
   * 端末の画面が消えている、繋ぎ直せない、といったことを人へ伝えるために使う。
   */
  readonly liveError?: string;
  /**
   * 証跡（`run.json`）を書いた場所。**置いた判定がどこに残ったかを人へ見せる。**
   * 見せないと、保存されたのかどうかが分からないまま終わる（実機で踏んだ）。
   */
  readonly runJsonPath?: string;
  /** 証跡を書けなかった理由。**黙って消さない。** */
  readonly saveError?: string;
  /** 人の判定を待っているケース番号。待っていなければ持たない。 */
  readonly awaiting?: number;
  /**
   * **いま指している場所**（要望シート No.1・2026-09-04）。
   *
   * > ある場所に矢印うにうにしたり、該当箇所四角く案内したりできますかね？
   *
   * AI がどこを触ったのかは、それまで**アダプタの中にしか無かった。**
   * 座標は**映像の中の座標**で、`screen` がその映像の実寸。
   * **枠の大きさへ直すのは画面側の仕事**（映像は枠より小さく描かれている）。
   */
  readonly pointing?: Pointing;
  /**
   * **鑑賞モードの案内**（2026-09-11・人の指示）。
   *
   * 在るときは、**人が押さなくても先へ進む。**
   * 押さずに進むことを、画面に出し続けるために要る（`pauseMs` は 1 件を見せる間）。
   */
  readonly watch?: { readonly pauseMs: number };
  readonly cases: readonly SessionCase[];
}

/** 指す場所。**名前は無くてよい**（座標だけでも指せる）。 */
export interface Pointing {
  readonly x: number;
  readonly y: number;
  /** その座標が乗っている映像の実寸。**0 は受けない**（枠へ直せない）。 */
  readonly screen: { readonly x: number; readonly y: number };
  /**
   * 指しているものの大きさ。**矢印を、その外へ置くために要る**
   * （2026-09-08「カレンダーならかぶっちゃだめでしょ」）。
   * **無いことがある**（絵から文字を読む道具が古いと、中心しか返らない）。
   */
  readonly width?: number;
  readonly height?: number;
  /** 何を指しているか（`「管理」` など）。人が読んで分かるもの。 */
  readonly label?: string;
}

/** 画面から実行器へ送る、打鍵 1 回分。 */
export type HumanInput =
  | { readonly kind: 'verdict'; readonly caseNo: number; readonly humanResult: HumanResult }
  /** 人が判定を置かずに次へ送った。**繰り上げない**ので、結果は `AUTO_PASS` になる。 */
  | { readonly kind: 'advance'; readonly caseNo: number }
  /**
   * **鑑賞をここで止める**（2026-09-11・人の指示）。
   *
   * > 途中で止められる配慮も必要です。
   *
   * 残りは「やっていない」ではなく **`BLOCKED`（判断保留）**として残る。
   * 走らせなかったものを「通った」にしない。
   */
  | { readonly kind: 'stop'; readonly caseNo: number }
  /**
   * 人がライブビューの中を触った。座標は**端末の画素**（画面の表示寸法ではない）。
   *
   * **AI が判断保留にして止まった後、人が自分で触って確かめる**のが中心の動き。
   * 見えるが触れない画面は、判断の材料にならない。
   */
  | {
      readonly kind: 'tap';
      readonly caseNo: number;
      readonly x: number;
      readonly y: number;
      /**
       * 座標がどの大きさの画面上のものか。
       *
       * **映像は端末より小さく流している**（720x1480 等）ので、
       * そのままの数値を端末へ渡すと違う所を触る（実機で押しても反応しなかった）。
       */
      readonly screen?: Point;
    }
  /**
   * 人がなぞった（スワイプ / フリック）。
   *
   * **タップだけでは Android を操作できない。**ホームへ戻る・一覧をたどるといった
   * 基本の動きがなぞる操作で、これが無いと人は画面の外へ出られない。
   */
  | {
      readonly kind: 'swipe';
      readonly caseNo: number;
      readonly from: Point;
      readonly to: Point;
      /** なぞるのにかけた時間。**速さがそのまま端末へ伝わる**（フリックか、ゆっくりかの差）。 */
      readonly durationMs: number;
      /** 座標がどの大きさの画面上のものか。 */
      readonly screen?: Point;
    }
  /**
   * 押し続けた（長押し）。**メニューを出す操作**がこれ。
   * タップと区別が付くよう、短すぎるものは受け取らない。
   */
  | {
      readonly kind: 'longPress';
      readonly caseNo: number;
      readonly x: number;
      readonly y: number;
      readonly durationMs: number;
      readonly screen?: Point;
    }
  /**
   * 人が端末へ文字を送った。
   *
   * **非 ASCII は送れない。**端末の `input text` は IME を通らないので、日本語は打てない
   * （AI 側と同じ制限・C34）。**黙って化けた文字を送るより、送れないと言うほうがよい。**
   */
  | { readonly kind: 'text'; readonly caseNo: number; readonly text: string };

/** 画面上の位置。 */
export interface Point {
  readonly x: number;
  readonly y: number;
}
/**
 * **置き直しはできる**（Issue 013）。`↑` で走ったケースへ戻り、もう一度押す。
 * 証跡には**最後に置いた 1 つだけ**が残る（打ち直しの履歴は持たない）。
 *
 * **ここには「取り消しはまだ無い」と書いてあった。**実装が追いついた後も直しておらず、
 * それを読んだ人から「戻れない」という前提で要望が来た
 * （外部レビュー meta-taro/git-qa#24）。**コードのコメントも、古くなれば嘘になる。**
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** ケース番号は置き場所（`case-001`）になるので、1 以上の整数だけを通す。 */
const isCaseNo = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

/** 画面上の位置。0 以上の整数だけを通す。 */
const isPixel = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const parsePoint = (value: unknown): Point | undefined => {
  if (!isRecord(value) || !isPixel(value['x']) || !isPixel(value['y'])) return undefined;
  return { x: value['x'], y: value['y'] };
};

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

export function parseHumanInput(raw: unknown): HumanInput | undefined {
  if (!isRecord(raw)) return undefined;

  if (!isCaseNo(raw['caseNo'])) return undefined;
  const caseNo = raw['caseNo'];

  if (raw['kind'] === 'advance') return { kind: 'advance', caseNo };

  // **鑑賞を止める。**見ているだけの人が止められないのは、見ているだけより悪い。
  if (raw['kind'] === 'stop') return { kind: 'stop', caseNo };

  if (raw['kind'] === 'swipe') {
    const from = parsePoint(raw['from']);
    const to = parsePoint(raw['to']);
    const durationMs = raw['durationMs'];
    if (from === undefined || to === undefined) return undefined;
    // 1 ms 未満は端末が受け取らない。長すぎるものは、押しっぱなしの取りこぼし。
    if (!isPixel(durationMs) || durationMs < 1 || durationMs > 10_000) return undefined;
    const screen = parsePoint(raw['screen']);
    return {
      kind: 'swipe',
      caseNo,
      from,
      to,
      durationMs,
      ...(screen === undefined ? {} : { screen }),
    };
  }

  if (raw['kind'] === 'text') {
    const text = raw['text'];
    if (typeof text !== 'string' || text === '' || text.length > 1000) return undefined;
    // 端末の入力は IME を通らない。**送れないものは受け取らない。**
    if (!/^[\x20-\x7e]+$/.test(text)) return undefined;
    return { kind: 'text', caseNo, text };
  }

  if (raw['kind'] === 'longPress') {
    const { x, y, durationMs } = raw;
    if (!isPixel(x) || !isPixel(y)) return undefined;
    // 300 ms 未満はタップと区別が付かない。**曖昧なものを端末へ送らない。**
    if (!isPixel(durationMs) || durationMs < 300 || durationMs > 10_000) return undefined;
    const screen = parsePoint(raw['screen']);
    return {
      kind: 'longPress',
      caseNo,
      x,
      y,
      durationMs,
      ...(screen === undefined ? {} : { screen }),
    };
  }

  if (raw['kind'] === 'tap') {
    const { x, y } = raw;
    // 端末は画素の位置しか受け取らない。**丸めずに捨てる**（どこを押したのかが曖昧なまま
    // 端末を触ると、証跡と実際がずれる）。
    if (!isPixel(x) || !isPixel(y)) return undefined;
    const screen = parsePoint(raw['screen']);
    return { kind: 'tap', caseNo, x, y, ...(screen === undefined ? {} : { screen }) };
  }

  if (raw['kind'] === 'verdict' && isOneOf(HUMAN_RESULTS, raw['humanResult'])) {
    // `AUTO_PASS` はここを通らない。**人が置ける値ではない**（C17）。
    return { kind: 'verdict', caseNo, humanResult: raw['humanResult'] };
  }
  return undefined;
}

const PHASES: readonly SessionPhase[] = ['running', 'waiting', 'watching', 'finished'];

function parseCase(raw: unknown): SessionCase | undefined {
  if (!isRecord(raw) || !isCaseNo(raw['no']) || typeof raw['title'] !== 'string') return undefined;

  const optional = <T extends string>(values: readonly T[], key: string): T | undefined | null => {
    const value = raw[key];
    if (value === undefined) return undefined;
    return isOneOf(values, value) ? value : null;
  };

  const aiResult = optional(AI_RESULTS, 'aiResult');
  const result = optional(CASE_RESULTS, 'result');
  if (aiResult === null || result === null) return undefined;

  const text = (key: string): string | undefined =>
    typeof raw[key] === 'string' ? raw[key] : undefined;

  const fields = parseFields(raw['fields']);
  // **半端な欄は画面に出さない。**形が違うものが 1 つでもあれば、欄ごと持たない。
  if (fields === null) return undefined;

  return {
    no: raw['no'],
    title: raw['title'],
    ...(fields === undefined ? {} : { fields }),
    ...(aiResult === undefined ? {} : { aiResult: aiResult }),
    ...(result === undefined ? {} : { result: result }),
    ...(text('verifiedBy') === undefined ? {} : { verifiedBy: text('verifiedBy') as string }),
    ...(text('note') === undefined ? {} : { note: text('note') as string }),
  };
}

/**
 * シートの欄を受け取る。**形が違えば `null`**（半端な欄を画面に出さない）。
 *
 * `undefined` は「無い」。今までのシート（欄を運んでいない実行）もそのまま動く。
 */
function parseFields(raw: unknown): readonly SessionField[] | undefined | null {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;

  const fields: SessionField[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const label = item['label'];
    const value = item['value'];
    if (typeof label !== 'string' || typeof value !== 'string') return null;
    fields.push({ label, value });
  }
  return fields;
}

function parsePointing(raw: unknown): Pointing | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw['x'] !== 'number' || typeof raw['y'] !== 'number') return undefined;

  const screen = raw['screen'];
  if (!isRecord(screen)) return undefined;
  if (typeof screen['x'] !== 'number' || typeof screen['y'] !== 'number') return undefined;
  // 実寸が無いと枠へ直せない。**当て推量で置かない。**
  if (screen['x'] <= 0 || screen['y'] <= 0) return undefined;

  const label = raw['label'];
  if (label !== undefined && typeof label !== 'string') return undefined;

  const width = raw['width'];
  const height = raw['height'];
  // **大きさは無くてよい。**無ければ矢印は点を指す（外へは置けない）。
  const size =
    typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0
      ? { width, height }
      : {};

  return {
    x: raw['x'],
    y: raw['y'],
    screen: { x: screen['x'], y: screen['y'] },
    ...size,
    ...(label === undefined ? {} : { label }),
  };
}

export function parseSessionState(raw: unknown): SessionState | undefined {
  if (!isRecord(raw) || typeof raw['runId'] !== 'string') return undefined;
  if (!isOneOf(PHASES, raw['phase'])) return undefined;
  if (!Array.isArray(raw['cases'])) return undefined;

  const cases: SessionCase[] = [];
  for (const item of raw['cases']) {
    const parsed = parseCase(item);
    // 1 件でも読めないなら、全部を捨てる。**半分だけ読めた一覧は、人を誤らせる。**
    if (parsed === undefined) return undefined;
    cases.push(parsed);
  }

  const awaiting = raw['awaiting'];
  if (awaiting !== undefined && !isCaseNo(awaiting)) return undefined;

  const sheetPath = raw['sheetPath'];
  if (sheetPath !== undefined && typeof sheetPath !== 'string') return undefined;

  const liveError = raw['liveError'];
  if (liveError !== undefined && typeof liveError !== 'string') return undefined;

  // **形が違えば、状態ごと捨てる。**当て推量で別の場所を指すと、人を誤らせる。
  let pointing: Pointing | undefined;
  if (raw['pointing'] !== undefined) {
    pointing = parsePointing(raw['pointing']);
    if (pointing === undefined) return undefined;
  }

  /**
   * **形がおかしければ、この値だけ落とす**（`pointing` と違って、状態ごとは捨てない）。
   *
   * 矢印は**間違った場所を指す**ので、疑わしければ状態ごと捨てるのが正しい。
   * こちらは案内の長さで、落としても画面は正しく出る。
   * **走っている最中に一覧が丸ごと消えるほうが、よほど困る。**
   */
  const watchRaw = raw['watch'];
  const watch =
    isRecord(watchRaw) && isPixel(watchRaw['pauseMs'])
      ? { pauseMs: watchRaw['pauseMs'] }
      : undefined;

  return {
    runId: raw['runId'],
    phase: raw['phase'],
    ...(awaiting === undefined ? {} : { awaiting }),
    ...(sheetPath === undefined ? {} : { sheetPath }),
    ...(liveError === undefined ? {} : { liveError }),
    ...(pointing === undefined ? {} : { pointing }),
    ...(watch === undefined ? {} : { watch }),
    cases,
  };
}
