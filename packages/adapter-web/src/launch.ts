/**
 * ブラウザを起こす。**人が持っているものを使う**（C54）。
 *
 * 検証専用にブラウザを落としてこない。「動く／動かない」を見る相手は、
 * **人が実際に使っているブラウザ**であるべきで、そこに差を作る理由が無い。
 */

/** 探しに行く場所。**先に見つかったものを使う。**無ければ、無いと言って止まる。 */
export const BROWSER_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
] as const;

export interface BrowserArgsOptions {
  /** 繋ぎ口。**0 を渡すと空いている番号を OS が選ぶ**（人の他の作業とぶつからない）。 */
  readonly port: number;
  /**
   * ブラウザの作業場所。
   *
   * **人のプロファイルを触らない。**指定しないと、開いているタブ・履歴・ログイン状態を
   * 持つ本物のプロファイルで起動してしまう。検証のために人の Chrome を乗っ取らない。
   */
  readonly userDataDir: string;
  /** 窓の大きさ。**同じ幅で見ないと、崩れの有無を比べられない。** */
  readonly size?: { readonly width: number; readonly height: number };
}

export function browserArgs(options: BrowserArgsOptions): string[] {
  return [
    `--remote-debugging-port=${String(options.port)}`,
    `--user-data-dir=${options.userDataDir}`,
    // 初回の案内・既定ブラウザの確認・復元の確認を出さない。**人の手を止めない。**
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    ...(options.size === undefined
      ? []
      : [`--window-size=${String(options.size.width)},${String(options.size.height)}`]),
    // **最初の画面は空。**行き先はシートの「# 対象:」が宣言したものだけ（C40）。
    'about:blank',
  ];
}

/**
 * 起こしたブラウザが標準エラーへ書く 1 行から、繋ぎ先を読む。
 *
 * **番号を 0 で開けている**ので、実際の番号はここからしか分からない。
 * **当て推量で繋がない** —— まだ出ていなければ undefined を返す。
 */
export function parseDevToolsUrl(stderr: string): string | undefined {
  const found = /ws:\/\/\S+/.exec(stderr);
  return found?.[0];
}

/**
 * 繋ぎ先（ws）から、対象の一覧を聞く先（http）を作る。
 *
 * **当て推量で聞きに行かない。**読めない形なら undefined を返し、呼ぶ側に判断させる。
 */
export function httpOriginFromWs(devToolsUrl: string): string | undefined {
  const found = /^ws:\/\/([^/]+)/.exec(devToolsUrl);
  return found === null ? undefined : `http://${found[1] as string}`;
}

/** ブラウザが並べてくる「対象」の 1 つ。中身は増えるので、要る所だけ読む。 */
export interface BrowserTarget {
  readonly type?: string;
  readonly url?: string;
  readonly webSocketDebuggerUrl?: string;
}

/**
 * 人が見る 1 枚を選ぶ。
 *
 * ブラウザは画面のほかに、拡張・裏方（service worker）・開発者ツールも並べてくる。
 * **そこを掴むと真っ白な絵が返る**ので、`page` かつ開発者ツールでないものだけを見る。
 */
export function pickPageTarget(targets: readonly BrowserTarget[]): string | undefined {
  for (const target of targets) {
    if (target.type !== 'page') continue;
    if (target.url?.startsWith('devtools://') === true) continue;
    if (typeof target.webSocketDebuggerUrl !== 'string') continue;
    return target.webSocketDebuggerUrl;
  }
  return undefined;
}

/**
 * ブラウザが作業場所に書く `DevToolsActivePort` を読む。
 *
 * **標準エラーの 1 行より、こちらが確か。**実測（2026-09-06）: macOS の Chrome を
 * 直に起こすと、標準エラーには**何も書かないまま**繋ぎ先だけがこのファイルに出た。
 * 20 秒待って「ブラウザは起きたが、繋ぎ先を言ってこない」で落ちた。
 *
 * 中身は 2 行。1 行目が番号、2 行目が道。
 */
export function parseActivePort(contents: string): string | undefined {
  const [port, path] = contents.split('\n');
  if (port === undefined || !/^\d+$/.test(port.trim())) return undefined;
  const suffix = path?.trim() ?? '';
  return `ws://127.0.0.1:${port.trim()}${suffix}`;
}
