/**
 * キーを本当に押す（外部レビュー meta-taro/git-qa#6）。
 *
 * それまで `System Events` の `keystroke` を使っていた。あれは**文字を打つ**ので、
 *
 * ```applescript
 * tell application "System Events" to keystroke "Enter"
 * ```
 *
 * は **「Enter」という 5 文字が入る。**特殊キーには `key code` が要る。
 * **押したつもりで文字が入る**ほうが、押せないより悪い —— 黙って別のことをするので、
 * 証跡を見ても「押したのに効かなかった」としか読めない。
 */

/**
 * 特殊キーの番号（macOS の仮想キーコード）。
 *
 * **知っているものだけを載せる。**載っていない名前は断る ——
 * 当てずっぽうで打つと「押したつもりで別の文字が入る」ことになる。
 */
const CODES: Readonly<Record<string, number>> = {
  enter: 36,
  return: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  arrowleft: 123,
  arrowright: 124,
  arrowdown: 125,
  arrowup: 126,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
};

/** 修飾キーの言い方。**`using` へ渡す形。** */
const MODIFIERS: Readonly<Record<string, string>> = {
  ctrl: 'control down',
  control: 'control down',
  cmd: 'command down',
  command: 'command down',
  meta: 'command down',
  alt: 'option down',
  option: 'option down',
  shift: 'shift down',
};

/**
 * `Ctrl+Enter` のような指定を、System Events の 1 行にする。
 *
 * **知らない名前は断る。**打てないことを、打ったことにしない。
 */
export function keyScript(key: string): string {
  const parts = key.split('+').map((p) => p.trim());
  const named = parts[parts.length - 1] ?? '';
  const modifiers = parts.slice(0, -1);

  const using = modifiers.map((m) => {
    const said = MODIFIERS[m.toLowerCase()];
    if (said === undefined) throw new Error(`知らない修飾キー: ${m}（${key}）`);
    return said;
  });
  const tail = using.length === 0 ? '' : ` using {${using.join(', ')}}`;

  const code = CODES[named.toLowerCase()];
  if (code !== undefined) {
    return `tell application "System Events" to key code ${String(code)}${tail}`;
  }

  // 1 文字なら、そのまま打つ（`keystroke` が正しい相手）。
  if ([...named].length === 1) {
    return `tell application "System Events" to keystroke ${JSON.stringify(named)}${tail}`;
  }

  throw new Error(
    `知らないキー: ${named}（${key}）。` +
      `送れるのは 1 文字か、${Object.keys(CODES).slice(0, 8).join(' / ')} などの名前`,
  );
}
