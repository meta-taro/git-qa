import { AdapterError } from '@git-qa/core';

/**
 * adb へ渡す引数の組み立てと、adb の出力の読み取り。
 *
 * **プロセスを起動しない純粋な部分をここへ集める。**端末が手元に無くても検査できるのは
 * この層で、実際に繋ぐ部分（`adapter.ts`）は薄くしておく。
 */

const KIND = 'android';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface AdbDevice {
  readonly serial: string;
  /** `device` 以外（`offline` / `unauthorized`）はそのまま持つ。捨てると理由が消える。 */
  readonly state: string;
}

/** `adb devices` の出力から端末を拾う。1 行目の見出しと空行は落とす。 */
export function parseDeviceList(stdout: string): AdbDevice[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('List of devices'))
    .map((line) => line.split(/\s+/))
    .filter((parts): parts is [string, string, ...string[]] => parts.length >= 2)
    .map(([serial, state]) => ({ serial, state }));
}

/** `-s <serial>` を前置きする。serial が無いときは付けない（端末が 1 台なら adb が選ぶ）。 */
export function withSerial(serial: string | undefined, args: readonly string[]): string[] {
  return serial === undefined ? [...args] : ['-s', serial, ...args];
}

/**
 * `input text` へ渡す文字列を、**端末側の sh** に食わせても壊れない形にする。
 *
 * adb は引数を空白で繋いで端末の sh へ渡すので、こちら側でクォートしても意味がない。
 * 空白は `input text` の仕様どおり `%s` に置き換え、sh に解釈される文字は escape する。
 */
export function escapeInputText(text: string): string {
  if (/[^\x20-\x7e]/.test(text)) {
    // 非 ASCII は `input text` では送れない（端末の IME を経由しないため）。
    // 黙って化けた文字を打つより、送れないと言うほうがよい。
    throw new AdapterError(
      KIND,
      `input text で送れない文字が含まれている（ASCII の印字可能文字のみ）: ${JSON.stringify(text)}`,
    );
  }
  return text.replace(/([\\"'`$&|;<>()*?[\]{}~#!])/g, '\\$1').replace(/ /g, '%s');
}

/** `key` の呼び名を Android のキーコードへ寄せる。既に KEYCODE_ で始まるならそのまま。 */
export function keycode(key: string): string {
  const upper = key.toUpperCase();
  return upper.startsWith('KEYCODE_') ? upper : `KEYCODE_${upper}`;
}

/** 解決済みの操作。座標が確定しているので、ここから先は組み立てるだけ。 */
export type ResolvedAction =
  | { readonly kind: 'tap'; readonly at: Point }
  | {
      readonly kind: 'swipe';
      readonly from: Point;
      readonly to: Point;
      readonly durationMs: number;
    }
  | { readonly kind: 'type'; readonly text: string; readonly at?: Point }
  | { readonly kind: 'key'; readonly key: string };

/**
 * 1 つの操作を `adb shell` の引数列へ。**複数になることがある**
 * （入力欄を選んでから打つ場合は tap と text の 2 本）ので、必ず配列の配列で返す。
 */
export function inputCommands(action: ResolvedAction): string[][] {
  switch (action.kind) {
    case 'tap':
      return [['shell', 'input', 'tap', String(action.at.x), String(action.at.y)]];
    case 'swipe':
      return [
        [
          'shell',
          'input',
          'swipe',
          String(action.from.x),
          String(action.from.y),
          String(action.to.x),
          String(action.to.y),
          String(action.durationMs),
        ],
      ];
    case 'type': {
      const type = ['shell', 'input', 'text', escapeInputText(action.text)];
      if (action.at === undefined) return [type];
      return [['shell', 'input', 'tap', String(action.at.x), String(action.at.y)], type];
    }
    case 'key':
      return [['shell', 'input', 'keyevent', keycode(action.key)]];
  }
}

/** `bounds="[0,63][1080,192]"` の中心。読めなければ undefined。 */
export function boundsCenter(bounds: string): Point | undefined {
  const m = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(bounds.trim());
  if (m === null) return undefined;
  const [x1, y1, x2, y2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
}

const ATTR = (node: string, name: string): string => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(node);
  return m?.[1] ?? '';
};

/**
 * uiautomator の dump から、指し示された要素の中心を出す。
 *
 * 参照は `resource-id` → `text` → `content-desc` の順に見る。**完全一致のみ。**
 * 部分一致にすると、画面が変わったときに別の要素を掴んで、しかも気づけない。
 */
export function findElementCenter(xml: string, ref: string): Point | undefined {
  // 空の参照を許すと、resource-id や content-desc が空のノード（画面上に多数ある）に
  // 当たってしまう。しかも「最初に見つかった何か」を掴むので、間違いに気づけない。
  if (ref === '') return undefined;

  for (const node of xml.match(/<node\b[^>]*>/g) ?? []) {
    const hit =
      ATTR(node, 'resource-id') === ref ||
      ATTR(node, 'text') === ref ||
      ATTR(node, 'content-desc') === ref;
    if (!hit) continue;
    const center = boundsCenter(ATTR(node, 'bounds'));
    if (center !== undefined) return center;
  }
  return undefined;
}

/** XML の実体参照を戻す。そのままだと、シートの期待結果と突き合わない。 */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&');
}

/**
 * uiautomator の dump から、**画面で読める文字**を集める。
 *
 * 期待結果（「〜と表示される」）との突き合わせに使う。`text` と `content-desc` の両方を見る。
 * 読み上げ用の説明しか持たない要素（アイコンだけのボタン）があるので、片方では足りない。
 */
export function screenText(xml: string): string {
  const found: string[] = [];
  for (const node of xml.match(/<node\b[^>]*\/?>/g) ?? []) {
    for (const name of ['text', 'content-desc']) {
      const value = unescapeXml(ATTR(node, name)).trim();
      if (value !== '') found.push(value);
    }
  }
  return found.join('\n');
}

/**
 * `wm size` の出力から実寸を読む。
 *
 * `Physical size: 1080x2220`（`Override size:` があればそちらが実際に使われる）。
 */
export function parseScreenSize(stdout: string): Point | undefined {
  const override = /Override size:\s*(\d+)x(\d+)/.exec(stdout);
  const physical = /Physical size:\s*(\d+)x(\d+)/.exec(stdout);
  const found = override ?? physical;
  if (found === null) return undefined;
  return { x: Number(found[1]), y: Number(found[2]) };
}
