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

/** 行頭の番号・箇条書き記号。書式は書き手によって揺れるので、まとめて剥がす。 */
const NUMBERING = /^\s*(?:\d+\s*[.)．、]|[-・*])\s*/;

/** `「X」に「Y」と入力する` / `X に「Y」と入力する` */
const TYPE_INTO = /^(?:「(?<target>[^」]+)」|(?<bare>.+?))に「(?<text>[^」]*)」と入力する$/;
/** 入力先を書かない形。直前にどこかを触っている前提。 */
const TYPE_ONLY = /^「(?<text>[^」]*)」と入力する$/;
/** `「X」をタップする` / `X をタップする`（クリックも同じ扱い） */
const TAP = /^(?:「(?<target>[^」]+)」|(?<bare>.+?))を(?:タップ|クリック)する?$/;

/** 端末の `input text` は IME を経由しないので、ASCII の範囲しか送れない。 */
const ASCII_ONLY = /^[\x20-\x7e]*$/;

function planType(text: string, target: string | undefined): PlannedStep {
  if (!ASCII_ONLY.test(text)) {
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

function planOneStep(text: string): PlannedStep {
  const into = TYPE_INTO.exec(text);
  if (into?.groups) {
    const target = into.groups['target'] ?? into.groups['bare'];
    return { ...planType(into.groups['text'] ?? '', target), text };
  }

  const only = TYPE_ONLY.exec(text);
  if (only?.groups) {
    return { ...planType(only.groups['text'] ?? '', undefined), text };
  }

  const tap = TAP.exec(text);
  if (tap?.groups) {
    const ref = tap.groups['target'] ?? tap.groups['bare'] ?? '';
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
 */
export function planSteps(stepsText: string): PlannedStep[] {
  const lines = stepsText
    .split(/\r?\n/)
    .map((line) => line.replace(NUMBERING, '').trim())
    .filter((line) => line !== '');

  if (lines.length === 0) {
    return [{ kind: 'hold', text: stepsText.trim(), reason: '手順が空' }];
  }
  return lines.map(planOneStep);
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
