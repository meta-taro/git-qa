/**
 * 画面の言葉で、指す相手を探す（C120）。
 *
 * 座標は使わない。**人が画面で読める言葉**（ボタンの文字・見出し・欄の名前）で指す。
 * ぴったり同じ名前 → その言葉で始まる名前 → 含む名前、の順で、画面の上から探す。
 */

/** 押せる・打てる・読める所。ここから target の言葉で探す。 */
export const TARGET_SELECTOR =
  'button, a, input, select, textarea, summary, label, legend, [role="button"], [role="tab"], ' +
  'h1, h2, h3, p, li, span, [data-agent-target]';

export type IsVisible = (el: HTMLElement) => boolean;

/** 人に見えているか。**隠れた要素は押させない。** */
export const visibleIn =
  (win: Window): IsVisible =>
  (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && win.getComputedStyle(el).visibility !== 'hidden';
  };

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** 要素の呼び名（画面に出ている文字・読み上げ名・説明・欄の見出し）。 */
export function namesOf(el: HTMLElement): string[] {
  const labelled =
    'labels' in el ? ((el as HTMLInputElement).labels?.[0]?.textContent ?? undefined) : undefined;
  return [
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.getAttribute('placeholder'),
    labelled,
    el.textContent,
  ]
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map(squash);
}

export function findTarget(
  doc: Document,
  target: string,
  isVisible: IsVisible,
): HTMLElement | undefined {
  const want = squash(target);
  if (want === '') return undefined;
  const candidates = [...doc.querySelectorAll(TARGET_SELECTOR)].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && isVisible(el),
  );
  const found =
    candidates.find((el) => namesOf(el).some((n) => n === want)) ??
    candidates.find((el) => namesOf(el).some((n) => n.startsWith(want))) ??
    candidates.find((el) => namesOf(el).some((n) => n.includes(want)));
  return found === undefined ? undefined : controlOf(doc, found);
}

/**
 * **欄の見出し（label）を指したら、その欄を指したことにする。**
 * 見出しは欄より先に並ぶので、見出しの文字で探すと見出し自身が先に見つかる。
 * 押す・打つ相手は欄のほう。
 */
const CONTROL = 'input, select, textarea';

function controlOf(doc: Document, el: HTMLElement): HTMLElement {
  if (el.tagName === 'LABEL') {
    const label = el as HTMLLabelElement;
    const byFor = label.htmlFor === '' ? null : doc.getElementById(label.htmlFor);
    return byFor ?? label.querySelector<HTMLElement>(CONTROL) ?? el;
  }
  // 欄の見出しが `<p>` や `<span>` で、そのすぐ後ろに欄が並ぶ作り（この画面の「0. あなたのハンドル」など）。
  if (/^(P|SPAN|LEGEND|H[1-3])$/.test(el.tagName)) {
    const next = el.nextElementSibling;
    if (next instanceof HTMLElement && next.matches(CONTROL)) return next;
  }
  return el;
}

export type Refusal = 'verdict' | 'handle';

/**
 * **エージェントが触ってはいけない所**（C1 / C17）。
 *
 * - 判定のキー（`.key-action`）：押すと証跡に「人が見た」と残る。**押すのは人だけ。**指すのは構わない
 * - ハンドルの欄（`.setup-operator`）：証跡の「誰が」。**打つのは人だけ**（外から呼ぶ道も人に残している・C112）
 */
export function whyRefused(
  el: HTMLElement,
  action: 'point' | 'click' | 'type',
): Refusal | undefined {
  if (action === 'point') return undefined;
  if (el.closest('.key-action') !== null) return 'verdict';
  if (action === 'type' && el.closest('.setup-operator') !== null) return 'handle';
  return undefined;
}

/** 人が押せる物。文字（p / span / 見出し）を指して「押した」ことにしない。 */
export const PRESSABLE_SELECTOR =
  'button, a, input, select, textarea, summary, label, [role="button"], [role="tab"]';

/** 指した所から、押せる物へ寄せる（札の文字 → その札のボタン）。無ければ undefined。 */
export function pressableOf(el: HTMLElement): HTMLElement | undefined {
  return el.closest<HTMLElement>(PRESSABLE_SELECTOR) ?? undefined;
}

export type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** 打てる欄か。 */
export function isField(el: HTMLElement): el is Field {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}
