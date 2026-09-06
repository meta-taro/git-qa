/**
 * Firefox で見る（Issue 018 / C56）。
 *
 * **Chrome とは別の約束。**Firefox は 129 で CDP を捨てているので、
 * 新しい Firefox で動くには **WebDriver BiDi** しか無い。
 * 古い Firefox（CDP を話す）に乗ると、**新しい Firefox の人の所で動かない**
 * —— それは「対応している」と書いた時点で、はったりになる（C56）。
 *
 * ここに置くのは**判断のある所**だけ（起こし方・繋ぎ先の読み取り・触り方）。
 * 実際に起こすのは `firefox-browser.ts`（配線）。
 */

/** 探しに行く場所。**先に見つかったものを使う。** */
export const FIREFOX_CANDIDATES = [
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
  '/usr/bin/firefox',
] as const;

export interface FirefoxArgsOptions {
  /** 繋ぎ口。**0 を渡すと空いている番号を OS が選ぶ。** */
  readonly port: number;
  /**
   * 作業場所。**人のプロファイルを触らない。**
   * 指定しないと、開いているタブ・履歴・ログイン状態を持つ本物で起動してしまう。
   */
  readonly profileDir: string;
  /** 窓の大きさ。**同じ幅で見ないと、崩れの有無を比べられない。** */
  readonly size?: { readonly width: number; readonly height: number };
}

export function firefoxArgs(options: FirefoxArgsOptions): string[] {
  return [
    '--remote-debugging-port',
    String(options.port),
    '--profile',
    options.profileDir,
    // 初回の案内・既定ブラウザの確認を出さない。**人の手を止めない。**
    '--no-remote',
    ...(options.size === undefined
      ? []
      : ['--window-size', `${String(options.size.width)},${String(options.size.height)}`]),
    'about:blank',
  ];
}

/**
 * 起こした Firefox が標準エラーへ書く 1 行から、繋ぎ先を読む。
 *
 * **CDP の 1 行を掴まない。**古い Firefox（89 で実測）は
 * `DevTools listening on ws://…` を出すが、それは CDP であって BiDi ではない。
 * 掴むと、繋いだ先で命令が全部断られる。
 */
export function parseBidiUrl(stderr: string): string | undefined {
  const found = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(stderr);
  return found?.[1];
}

/** BiDi の入力 1 つ分。 */
export interface BidiAction {
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly value?: string;
  readonly button?: number;
}

export interface BidiActionGroup {
  readonly type: 'pointer' | 'key';
  readonly id: string;
  readonly actions: readonly BidiAction[];
}

/**
 * 押す動き。**BiDi は「動きの並び」で送る**（CDP のように 1 命令ずつではない）。
 *
 * 動かしてから押す。**hover でしか出ないものがある。**
 */
export function pointerActions(point: { x: number; y: number }): BidiActionGroup[] {
  return [
    {
      type: 'pointer',
      id: 'mouse',
      actions: [
        { type: 'pointerMove', x: point.x, y: point.y },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ];
}

/**
 * 文字を打つ動き。**1 文字ずつ、押して離す。**
 *
 * ブラウザは IME を通さないので、**日本語もそのまま送れる**（Android と違う）。
 */
export function typeActions(text: string): BidiActionGroup[] {
  const actions: BidiAction[] = [];
  for (const character of [...text]) {
    actions.push({ type: 'keyDown', value: character });
    actions.push({ type: 'keyUp', value: character });
  }
  return [{ type: 'key', id: 'keyboard', actions }];
}

/**
 * ドラッグの動き。**掴んで、途中を通ってから離す。**
 *
 * 1 回で運ぶと、並べ替えの UI では何も起きない（掴んだ先が「途中の動き」を見ている）。
 */
export function dragActions(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10,
): BidiActionGroup[] {
  const actions: BidiAction[] = [
    { type: 'pointerMove', x: from.x, y: from.y },
    { type: 'pointerDown', button: 0 },
  ];
  for (let i = 1; i <= steps; i += 1) {
    actions.push({
      type: 'pointerMove',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
    });
  }
  actions.push({ type: 'pointerUp', button: 0 });
  return [{ type: 'pointer', id: 'mouse', actions }];
}
