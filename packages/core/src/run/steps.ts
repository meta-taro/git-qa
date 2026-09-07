import type { Action } from '../adapter/types.js';

/**
 * 検証シートの日本語の手順・期待結果を、機械が扱える形へ落とす。
 *
 * **ここは意図的に賢くしない。**落とせない文は推測で操作へ変えず、判断保留として人へ渡す。
 * 推測して別の要素を触ると、画面は動くので通ったように見え、**間違いに気づけない**
 * （`adapter-android` で要素の指定を完全一致だけにしたのと同じ理由）。
 */

/** 操作へ落ちた 1 手順。 */
export interface PlannedAction {
  readonly kind: 'action';
  /** 番号を剥がした原文。証跡の足跡（`RunStep.label`）にそのまま出す。 */
  readonly text: string;
  readonly action: Action;
}

/** 落とせなかった 1 手順。**AI はここで止まって人へ渡す。** */
export interface PlannedHold {
  readonly kind: 'hold';
  readonly text: string;
  readonly reason: string;
}

export type PlannedStep = PlannedAction | PlannedHold;

export interface PlanOptions {
  /**
   * シートの見出し（`# 対象:`）が宣言した対象の識別子。
   * Android ならパッケージ名、ウェブなら URL。
   * **無ければ「アプリを起動する」「ページを開く」は保留になる。**
   */
  readonly app?: string;
  /**
   * 文字をそのまま送れるか。
   *
   * Android の `input text` は IME を通らないので ASCII しか送れない（既定）。
   * ブラウザはそのまま入るので `'any'`。**Android の事情を全部の相手に押し付けない。**
   */
  readonly textInput?: 'ascii-only' | 'any';
  /**
   * 行き先の書き方。
   *
   * Android はパッケージ名、ウェブは URL（既定の `'package-or-url'`）。
   * **デスクトップはアプリ名そのもの**なので `'name'`。
   *
   * 表示名を通さないという決めごと（C40）は Android の話で、
   * どのパッケージかが端末と地域で変わるのが理由。**その問題が無い相手にまで押し付けない。**
   */
  readonly appId?: 'package-or-url' | 'name';
}

/** 行頭の番号・箇条書き記号。書式は書き手によって揺れるので、まとめて剥がす。 */
const NUMBERING = /^\s*(?:\d+\s*[.)．、]|[-・*])\s*/;

/** `「X」に「Y」と入力する` / `X に「Y」と入力する` */
const TYPE_INTO = /^(?:「(?<target>[^」]+)」|(?<bare>.+?))に「(?<text>[^」]*)」と入力する$/;
/** 入力先を書かない形。直前にどこかを触っている前提。 */
const TYPE_ONLY = /^「(?<text>[^」]*)」と入力する$/;
/** `「X」をタップする` / `X をタップする`（クリックも同じ扱い） */
const TAP = /^(?:「(?<target>[^」]+)」|(?<bare>.+?))を(?:タップ|クリック)する?$/;
/**
 * `「X」を押す` / `「X」を押下する`。**日本語の button は「押す」と書かれる。**
 *
 * 2026-09-07、連動くん（browser-sync-agent）の実物の検証シート 55 行を通したら、
 * 「「⚙ 管理」を押す」のような行がすべて落ちた。
 *
 * **鉤括弧を必須にしている。**「Win+← を押す」「Enter を押す」は**キーの話**で、
 * 画面に見えている文字ではない。「クリック」なら括弧が無くても要素だと決まるが、
 * 「押す」は決まらない。**決まらないものを当てにいかない。**
 */
const PRESS = /^「(?<target>[^」]+)」を押(?:す|下する)$/;

/** `「X」を起動する` / `X を起動する` */
const LAUNCH = /^(?:「(?<target>[^」]+)」|(?<bare>.+?))\s*を(?:(?:起動|開始)する|開く)$/;
/** シートの見出しが宣言したアプリを指す言い方。**特定のアプリ名は含めない。** */
/** `「A」を「B」へドラッグする`。**なぞる（スクロール）とは別物。** */
const DRAG =
  /^(?:「(?<from>[^」]+)」|(?<fromBare>.+?))を(?:「(?<to>[^」]+)」|(?<toBare>.+?))[へに](?:ドラッグ(?:＆|&|アンド)?(?:ドロップ)?)する$/;
const THE_APP = /^(?:対象)?アプリ(?:ケーション)?$/;
/**
 * ウェブの言い方。**実物のシートは「ページを開く」と書く。**
 *
 * 2026-09-06、見本のシートが 1 行目「ページを起動する」で止まった。
 * Android のパッケージ名しか通していなかったのが理由（C40 と同じ形）。
 */
const THE_PAGE = /^(?:対象)?(?:ページ|画面|サイト)$/;
/** そのまま書かれた行き先。**`# 対象:` が無くてもここだけは決まる。** */
const URL_ID = /^https?:\/\/\S+$/;
/**
 * 対象側の識別子として通す形。Android のパッケージ名（`com.example.app`）。
 * **表示名（「設定」）は通さない。**どのパッケージかは端末と地域で変わるので、
 * 当てにいくと別のアプリを起動したまま画面が動き、通ったように見える。
 */
const APP_ID = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/** 端末の `input text` は IME を経由しないので、ASCII の範囲しか送れない。 */
const ASCII_ONLY = /^[\x20-\x7e]*$/;

function planType(
  text: string,
  target: string | undefined,
  textInput: 'ascii-only' | 'any',
): PlannedStep {
  if (textInput === 'ascii-only' && !ASCII_ONLY.test(text)) {
    // 黙って化けた文字を打つより、送れないと言うほうがよい（adapter-android と同じ判断）。
    return {
      kind: 'hold',
      text: target === undefined ? `「${text}」と入力する` : `${target}に「${text}」と入力する`,
      reason: `端末の入力は IME を通らないので「${text}」を送れない。人が入力する必要がある`,
    };
  }
  const action: Action =
    target === undefined
      ? { kind: 'type', text }
      : { kind: 'type', text, target: { at: 'element', ref: target } };
  return {
    kind: 'action',
    text: target === undefined ? `「${text}」と入力する` : `${target}に「${text}」と入力する`,
    action,
  };
}

/**
 * 起動先を決める。**書いてあるものだけを使う。**
 *
 * 実物の検証シートは、ほぼ必ず 1 行目が「アプリを起動する」で始まる。
 * ここを落とせないと、どのシートも 1 件目で止まる（2026-09-02 の実行記録がその形だった）。
 */
function planLaunch(
  rawName: string,
  app: string | undefined,
  text: string,
  appId: 'package-or-url' | 'name',
): PlannedStep {
  // 書き手は「URL を開く」と空けて書く。**前後の空白で行き先を見失わない。**
  const named = rawName.trim();

  // 名前で指す相手なら、書いてあるものをそのまま使う。
  const usable = (value: string): boolean =>
    appId === 'name' ? value.trim() !== '' : APP_ID.test(value) || URL_ID.test(value);

  // 行き先がそのまま書いてある。
  if (appId !== 'name' && (APP_ID.test(named) || URL_ID.test(named))) {
    return { kind: 'action', text, action: { kind: 'launch', app: named } };
  }

  // 「アプリ」「ページ」のように**対象そのもの**を指している。見出しが宣言した先へ行く（C40）。
  const theTarget = THE_APP.test(named) || THE_PAGE.test(named);
  if (!theTarget) {
    return {
      kind: 'hold',
      text,
      reason:
        `どこを開くか決められない: ${named}。` +
        'パッケージ名（例 com.example.app）か URL（例 http://localhost:3000/）で書く',
    };
  }
  if (app === undefined) {
    return {
      kind: 'hold',
      text,
      reason:
        '開く先が分からない。シートの見出し「# 対象:」に' +
        'パッケージ名（例 com.example.app）か URL（例 http://localhost:3000/）を書く',
    };
  }
  if (usable(app)) {
    return { kind: 'action', text, action: { kind: 'launch', app } };
  }
  return {
    kind: 'hold',
    text,
    reason: `シートの見出し「# 対象:」が、パッケージ名でも URL でもない: ${app}`,
  };
}

function planOneStep(
  text: string,
  app: string | undefined,
  textInput: 'ascii-only' | 'any',
  appId: 'package-or-url' | 'name',
): PlannedStep {
  const into = TYPE_INTO.exec(text);
  if (into?.groups) {
    const target = into.groups['target'] ?? into.groups['bare'];
    return { ...planType(into.groups['text'] ?? '', target, textInput), text };
  }

  const only = TYPE_ONLY.exec(text);
  if (only?.groups) {
    return { ...planType(only.groups['text'] ?? '', undefined, textInput), text };
  }

  const launch = LAUNCH.exec(text);
  if (launch?.groups) {
    const named = launch.groups['target'] ?? launch.groups['bare'] ?? '';
    return planLaunch(named, app, text, appId);
  }

  const drag = DRAG.exec(text);
  if (drag?.groups) {
    const from = drag.groups['from'] ?? drag.groups['fromBare'] ?? '';
    const to = drag.groups['to'] ?? drag.groups['toBare'] ?? '';
    return {
      kind: 'action',
      text,
      action: {
        kind: 'drag',
        from: { at: 'element', ref: from.trim() },
        to: { at: 'element', ref: to.trim() },
      },
    };
  }

  const tap = TAP.exec(text);
  if (tap?.groups) {
    const ref = tap.groups['target'] ?? tap.groups['bare'] ?? '';
    return { kind: 'action', text, action: { kind: 'tap', target: { at: 'element', ref } } };
  }

  const press = PRESS.exec(text);
  if (press?.groups) {
    const ref = press.groups['target'] ?? '';
    return { kind: 'action', text, action: { kind: 'tap', target: { at: 'element', ref } } };
  }

  return {
    kind: 'hold',
    text,
    reason: `この手順を操作へ落とせない: ${text}`,
  };
}

/**
 * 手順の欄を 1 手順ずつに割って、操作へ落とす。
 *
 * **空の操作列は返さない。**「やることが無い」と「読めなかった」が区別できなくなる。
 *
 * `app` は、シートの見出しが宣言した対象アプリの識別子。「アプリを起動する」の行き先になる。
 */
export function planSteps(stepsText: string, options: PlanOptions = {}): PlannedStep[] {
  const lines = stepsText
    .split(/\r?\n/)
    .map((line) => line.replace(NUMBERING, '').trim())
    .filter((line) => line !== '');

  if (lines.length === 0) {
    return [{ kind: 'hold', text: stepsText.trim(), reason: '手順が空' }];
  }
  const textInput = options.textInput ?? 'ascii-only';
  const appId = options.appId ?? 'package-or-url';
  return lines.map((line) => planOneStep(line, options.app, textInput, appId));
}

/** 画面に在るかどうかで決まる期待結果。 */
export interface ExpectationContains {
  readonly kind: 'contains';
  readonly text: string;
}

/** 機械では決められない期待結果。**人が見るしかない。** */
export interface ExpectationHold {
  readonly kind: 'hold';
  readonly reason: string;
}

export type ExpectationCheck = ExpectationContains | ExpectationHold;

const QUOTED = /「([^」]*)」/g;

/**
 * 期待結果を、機械で見られる形に落とす。
 *
 * **落とせるのは「鉤括弧が 1 つだけ」の場合に限る。**2 つ以上あるとどちらを見ればよいか
 * 決められず、0 個なら見る文字列が無い。**曖昧なら人へ渡す。**
 */
export function planExpectation(expectedText: string): ExpectationCheck {
  const quoted = [...expectedText.matchAll(QUOTED)]
    .map((m) => m[1] ?? '')
    .filter((text) => text !== '');

  if (quoted.length === 1) {
    return { kind: 'contains', text: quoted[0] as string };
  }
  const reason =
    quoted.length === 0
      ? `期待結果を機械で判定できない（画面で探す文字列が無い）: ${expectedText.trim()}`
      : `期待結果に鉤括弧が ${String(quoted.length)} 個あり、どれを見るか決められない: ${expectedText.trim()}`;
  return { kind: 'hold', reason };
}

/**
 * 画面から取れた文字と突き合わせる。
 *
 * **見ているのは「在るか」だけ。**「〜だけが残る」のような排他は確かめられないので、
 * 呼び出し側が証跡へその旨を残す。
 */
export function judgeExpectation(check: ExpectationContains, screenText: string): 'PASS' | 'FAIL' {
  return screenText.includes(check.text) ? 'PASS' : 'FAIL';
}
