/**
 * キーを本当に押す（外部レビュー meta-taro/git-qa#6）。
 *
 * それまで `key` だけを送っていた。
 *
 * ```ts
 * cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: action.key });
 * ```
 *
 * **届くが、効かない。**実物で確かめた（2026-09-13）——
 * `<form onsubmit=…>` の中で Enter を送っても、題は変わらなかった。
 * Chrome は `windowsVirtualKeyCode` が無いと**既定の動作**（送信・改行）を起こさない。
 *
 * **「送った」と「効いた」は別。**
 */

interface KeySpec {
  readonly code: string;
  readonly number: number;
  /** 文字として入るもの（Enter は `\r`）。入らないキーは持たない。 */
  readonly text?: string;
}

/**
 * 特殊キー。**知っているものだけを載せる。**
 * 載っていない名前は断る —— 当てずっぽうで送ると、押したつもりで何も起きない。
 */
const KEYS: Readonly<Record<string, KeySpec>> = {
  enter: { code: 'Enter', number: 13, text: '\r' },
  return: { code: 'Enter', number: 13, text: '\r' },
  tab: { code: 'Tab', number: 9, text: '\t' },
  escape: { code: 'Escape', number: 27 },
  esc: { code: 'Escape', number: 27 },
  backspace: { code: 'Backspace', number: 8 },
  delete: { code: 'Delete', number: 46 },
  space: { code: 'Space', number: 32, text: ' ' },
  arrowup: { code: 'ArrowUp', number: 38 },
  arrowdown: { code: 'ArrowDown', number: 40 },
  arrowleft: { code: 'ArrowLeft', number: 37 },
  arrowright: { code: 'ArrowRight', number: 39 },
  home: { code: 'Home', number: 36 },
  end: { code: 'End', number: 35 },
  pageup: { code: 'PageUp', number: 33 },
  pagedown: { code: 'PageDown', number: 34 },
};

/** 修飾キーの重み（CDP の決め）。 */
const MODIFIERS: Readonly<Record<string, number>> = {
  alt: 1,
  option: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

export interface KeyEvent {
  readonly type: 'keyDown' | 'keyUp';
  readonly key: string;
  readonly code: string;
  readonly windowsVirtualKeyCode: number;
  readonly nativeVirtualKeyCode: number;
  readonly modifiers: number;
  readonly text?: string;
}

/** `Ctrl+Enter` のような指定を、押す・離すの 2 つにする。 */
export function keyEvents(key: string): [KeyEvent, KeyEvent] {
  const parts = key.split('+').map((p) => p.trim());
  const named = parts[parts.length - 1] ?? '';

  let modifiers = 0;
  for (const part of parts.slice(0, -1)) {
    const weight = MODIFIERS[part.toLowerCase()];
    if (weight === undefined) throw new Error(`知らない修飾キー: ${part}（${key}）`);
    modifiers |= weight;
  }

  const known = KEYS[named.toLowerCase()];
  const spec: KeySpec =
    known ??
    // 1 文字なら、そのまま文字として送る。
    ([...named].length === 1
      ? {
          code: `Key${named.toUpperCase()}`,
          number: named.toUpperCase().charCodeAt(0),
          text: named,
        }
      : (() => {
          throw new Error(
            `知らないキー: ${named}（${key}）。` +
              `送れるのは 1 文字か、${Object.keys(KEYS).slice(0, 8).join(' / ')} などの名前`,
          );
        })());

  const base = {
    key: known === undefined ? named : keyName(named),
    code: spec.code,
    windowsVirtualKeyCode: spec.number,
    nativeVirtualKeyCode: spec.number,
    modifiers,
  };

  return [
    // **押すときだけ文字を載せる。**離すときに載せると、2 回入る。
    { ...base, type: 'keyDown', ...(spec.text === undefined ? {} : { text: spec.text }) },
    { ...base, type: 'keyUp' },
  ];
}

/** 画面へ渡す名前（`esc` と書かれても `Escape` として送る）。 */
function keyName(named: string): string {
  const spec = KEYS[named.toLowerCase()];
  return spec?.code ?? named;
}
