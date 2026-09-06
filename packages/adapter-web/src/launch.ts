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
