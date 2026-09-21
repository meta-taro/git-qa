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
  readonly textInput?: 'none' | 'ascii-only' | 'any';
  /**
   * キーを送れるか（`AdapterCapabilities.keyInput`・外部レビュー #6）。
   * **送れない相手には回さない** —— 走らせて落ちるより、人へ回すほうが読める。
   */
  readonly keyInput?: boolean;
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
 * 2026-09-07、実物の検証シート 55 行（あるデスクトップアプリのもの）を通したら、
 * 「「⚙ 管理」を押す」のような行がすべて落ちた。
 *
 * **鉤括弧を必須にしている。**「Win+← を押す」「Enter を押す」は**キーの話**で、
 * 画面に見えている文字ではない。「クリック」なら括弧が無くても要素だと決まるが、
 * 「押す」は決まらない。**決まらないものを当てにいかない。**
 */
const PRESS = /^「(?<target>[^」]+)」を押(?:す|下する)$/;

/**
 * `Enter キーを押す` / `Ctrl+Enter キーを押す`（外部レビュー meta-taro/git-qa#6）。
 *
 * > 同じクエリがキーボードでは通り、ボタンでは通らないなら、不具合はボタンの配線にある。
 * > No.5 は飾りではなく、どちらが壊れているかを分ける 1 行。
 *
 * **鉤括弧＝画面の要素、という決まりは崩さない。****「キー」の 1 語で決める。**
 * 括弧なしの「Enter を押す」は、いまも決められない —— ただし
 * **決められないと言うだけでなく、どう書けばよいかを言う**（下の `HOLD_PRESS`）。
 */
const KEY_PRESS = /^(?<key>[^\s「」]+)\s*キーを押(?:す|下する)$/;

/** 括弧なしで「押す」と書かれたもの。**書き方を教えるためだけに見る。** */
const BARE_PRESS = /^(?<what>[^「」]+?)を押(?:す|下する)$/;

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
  textInput: 'none' | 'ascii-only' | 'any',
): PlannedStep {
  // **送る口を持たない相手。**送ろうとして実行時に落ちるより、人へ回すほうがよい。
  if (textInput === 'none') {
    return {
      kind: 'hold',
      text: target === undefined ? `「${text}」と入力する` : `${target}に「${text}」と入力する`,
      reason: `この相手には文字を送れない。人が入力する必要がある`,
    };
  }
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
  /**
   * **どの見出しを見たかを出す**（外部レビュー meta-taro/git-qa#37）。
   *
   * > `行き先` を書いた側としては、**書いたものが効いていないのか、書き方が違うのか**が
   * > 切り分けられませんでした
   *
   * ここへ渡ってくる `app` は **`行き先` が在ればそちら、無ければ `対象`**
   * （`sheetDestination`）。**どちらを見たかを言わないと、
   * `行き先` を書いた人の視界に、自分の書いたものが入らない。**
   */
  return {
    kind: 'hold',
    text,
    reason:
      `シートの見出し（「# 行き先:」が在ればそちら、無ければ「# 対象:」）が、` +
      `パッケージ名でも URL でもない: ${app}`,
  };
}

function planOneStep(
  text: string,
  app: string | undefined,
  textInput: 'none' | 'ascii-only' | 'any',
  appId: 'package-or-url' | 'name',
  keyInput: boolean,
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

  const key = KEY_PRESS.exec(text);
  if (key?.groups) {
    const named = key.groups['key'] ?? '';
    // **送れない相手には回さない**（C20）。走らせて落ちるより、人へ回すほうが読める。
    if (!keyInput) {
      return {
        kind: 'hold',
        text,
        reason: `この相手にはキー（${named}）を送れない。人が押す必要がある`,
      };
    }
    return { kind: 'action', text, action: { kind: 'key', key: named } };
  }

  const bare = BARE_PRESS.exec(text);
  if (bare?.groups) {
    // **決められないと言うだけで終わらせない。**どう書けば動くかを、その場で言う。
    const what = (bare.groups['what'] ?? '').trim();
    return {
      kind: 'hold',
      text,
      reason:
        `「${what}」が画面の文字なのかキーなのか決められない。` +
        `画面の要素なら「${what}」を押す、キーなら ${what} キーを押す、と書いてください`,
    };
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
  // **キーを送れるかは相手が名乗る**（外部レビュー #6）。ここで推し量らない。
  const keyInput = options.keyInput ?? true;
  return lines.map((line) => planOneStep(line, options.app, textInput, appId, keyInput));
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
 * **画面に出る文字を指している**と読める言い方（外部レビュー meta-taro/git-qa#27）。
 *
 * 鉤括弧の**すぐ後ろ**を見る。**文末ではない** ——
 * 「「…」と表示され、保存されない」のように、
 * **画面の文字を指したうえで別のことも言う**書き方が普通にあるため。
 */
const SHOWN_AFTER: readonly string[] = [
  'と表示され',
  'が表示され',
  'は表示され',
  'も表示され',
  'と出',
  'が出',
  'は出',
  'と書かれ',
  'が書かれ',
  'と見え',
  'が見え',
  'と現れ',
  'が現れ',
];

/**
 * 打ち消し。**「在るか」しか見られない**ので、「出ない」は確かめられない。
 * ここを落とすと、**言っていることの逆**を判定することになる。
 */
const NOT_SHOWN = /^(?:ない|ず|ません|なくなる|なくなっている|ていない)/;

/** 鉤括弧の後ろが、画面の文字を指しているか。 */
function pointsAtScreenText(after: string): boolean {
  const rest = after.trimStart();
  for (const word of SHOWN_AFTER) {
    if (!rest.startsWith(word)) continue;
    return !NOT_SHOWN.test(rest.slice(word.length));
  }
  return false;
}

/**
 * 期待結果を、機械で見られる形に落とす。
 *
 * **落とせるのは 2 つとも満たすときだけ。**
 *
 * 1. 鉤括弧が 1 組（2 つ以上あるとどちらを見ればよいか決められない）
 * 2. **その後ろが「画面に出る文字を指す言い方」**（外部レビュー meta-taro/git-qa#27）
 *
 * 2 を見ていなかったので、**判定として成立しない行が「機械で判定できた行」として
 * 結果に並んでいた。**
 *
 * ```text
 * contains("選択できない")  <= 今日から 2 日後までが「選択できない」状態になっている
 * contains("定休日")       <= 「定休日」の日は押せない
 * ```
 *
 * 前者は**実装が正しくても必ず落ちる。**後者は**押せることを一度も確かめずに合格が付く。**
 * **曖昧なら人へ渡す。**
 */
export function planExpectation(expectedText: string): ExpectationCheck {
  const matches = [...expectedText.matchAll(QUOTED)].filter((m) => (m[1] ?? '') !== '');

  if (matches.length === 1) {
    const hit = matches[0] as RegExpMatchArray;
    const after = expectedText.slice((hit.index ?? 0) + hit[0].length);
    if (pointsAtScreenText(after)) {
      return { kind: 'contains', text: hit[1] as string };
    }
    /**
     * **言い換えを勧めない**（#27 のいちばん効いている指摘）。
     *
     * > **但し書きに従うほど、判定が間違った方向に確定します。**
     *
     * 「鉤括弧を足せば通る」と読ませると、**hold（正直に放棄した状態）から、
     * 言っていることの逆を判定する状態へ移る。**
     */
    return {
      kind: 'hold',
      reason:
        '期待結果に鉤括弧はあるが、**画面に出る文字**を指しているか判断できないので人が見る' +
        `（押せる・選べる・状態になっている、は画面の文字ではないので言い換えても判定できない）: ${expectedText.trim()}`,
    };
  }

  const reason =
    matches.length === 0
      ? '期待結果を機械で判定できないので人が見る' +
        `（**画面に出る文字**を「…」で囲んで「と表示される」と書けるものだけ判定できる。押せる・選べるは判定できない）: ${expectedText.trim()}`
      : `期待結果に鉤括弧が ${String(matches.length)} 個あり、どれを見るか決められない: ${expectedText.trim()}`;
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
