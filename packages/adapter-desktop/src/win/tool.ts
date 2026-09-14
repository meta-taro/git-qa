/**
 * Windows のデスクトップ検証に使う道具（`git-qa-win`）の呼び方と、返りの読み方。
 *
 * > デスクトップアプリ試験導入予定なんです。……顧客対象が大抵 win なので、
 * > win で検証する必要があります。（2026-09-12・人の指示）
 *
 * macOS 側は 3 本に分かれている（`git-qa-ocr` / `git-qa-input` / `git-qa-record`）。
 * **Windows は 1 本。**窓・文字・操作がどれも同じ口（Win32 と UI Automation）から
 * 取れるので、分ける理由が無い。
 *
 * **出す形は macOS と揃えてある。**読む側を OS ごとに分けないため ——
 * 文字の一覧は `name \t x \t y \t w \t h` で、`parseOcr` がそのまま読める。
 */

/** `git-qa-win` に渡す引数。**数はここで丸める**（道具の側で弾かれないように）。 */
export const winArgs = {
  windows: (app: string): string[] => ['windows', app],
  shot: (hwnd: number, out: string): string[] => ['shot', String(hwnd), out],
  text: (hwnd: number): string[] => ['text', String(hwnd)],
  press: (hwnd: number, x: number, y: number): string[] => [
    'press',
    String(hwnd),
    String(Math.round(x)),
    String(Math.round(y)),
  ],
  /**
   * その欄の中身を、渡した文字に**置き換える**（追記ではない）。
   * **日本語もそのまま入る**（2026-09-14・実測。IME を通らない）。
   */
  type: (hwnd: number, x: number, y: number, text: string): string[] => [
    'type',
    String(hwnd),
    String(Math.round(x)),
    String(Math.round(y)),
    text,
  ],
  /** 回す。**正で下、負で上。**画素ではなく回数（1 段の大きさは相手が決める）。 */
  scroll: (hwnd: number, x: number, y: number, notches: number): string[] => [
    'scroll',
    String(hwnd),
    String(Math.round(x)),
    String(Math.round(y)),
    String(Math.round(notches)),
  ],
  exe: (pid: number): string[] => ['exe', String(pid)],
} as const;

/** 見つかった窓 1 つ。 */
export interface WinWindow {
  readonly hwnd: number;
  readonly pid: number;
  readonly exe: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const COLUMNS = 8;

/**
 * 窓の一覧を読む。
 *
 * **読めない行は捨てる。**当て推量で別の窓を触らない。
 * **大きさの無い窓も捨てる** —— 撮れないし、押す場所も決まらない。
 */
export function parseWinWindows(stdout: string): WinWindow[] {
  const found: WinWindow[] = [];

  for (const line of stdout.split('\n')) {
    const cells = line.split('\t');
    if (cells.length !== COLUMNS) continue;

    const [hwnd, pid, exe, title, x, y, width, height] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const numbers = [hwnd, pid, x, y, width, height].map(Number);
    if (numbers.some((n) => !Number.isFinite(n))) continue;

    const one: WinWindow = {
      hwnd: Number(hwnd),
      pid: Number(pid),
      exe,
      title,
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
    };
    if (one.width < 1 || one.height < 1) continue;
    found.push(one);
  }
  return found;
}

/**
 * 相手にする窓を 1 つ決める（2026-09-12・Windows 機で実測して足した）。
 *
 * それまでは**見つかった順の 1 つ目**を使っていた。実機で 2 種類の外し方をした。
 *
 * - `sshboard` を探すと、**窓の題にパスが入っている explorer** が先に出る
 * - 当の `sshboard` 自身も、**16x16 の隠れ窓**（Tauri の道具窓）を持っていて、それが先に出る
 *
 * どちらも「見つからない」ではなく「**別のものを相手にして、静かに間違える**」。
 * 16x16 の絵を証跡に残したまま、人は検証したつもりになる。
 *
 * **題は、相手が何を開いているかで変わる。**実行ファイルの名前は変わらないので、そちらを先に見る。
 */
export function pickWindow(found: readonly WinWindow[], app: string): WinWindow | undefined {
  const want = app.toLowerCase();
  const byExe = found.filter((one) => exeStem(one.exe).includes(want));

  // 実行ファイル名で当たらなければ、題で当たったものの中から選ぶ
  // （道具の側で、題か実行ファイル名のどちらかに当たったものだけが来ている）。
  return biggest(byExe.length > 0 ? byExe : found);
}

/**
 * 拡張子を除いた実行ファイル名（小文字）。
 *
 * **区切りは `\` も `/` も見る。**`/` だけで切ると `C:\tools\sshboard\viewer.exe` が
 * まるごと名前として残り、**途中のフォルダ名で当たってしまう**（2026-09-12・テストで捕まえた）。
 */
function exeStem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  return name.replace(/\.[^.]*$/, '').toLowerCase();
}

/**
 * **人が見ている窓の、いちばん小さい側の目安**（px）。
 *
 * 実測で残った道具窓は 16x16。検証の相手になる画面がこれより小さいことは無い。
 * **境目は目安であって、厳密な線ではない** —— 小さすぎる窓を黙って相手にしないための堰。
 */
const MIN_HUMAN_SIZE = 120;

/**
 * その窓が検証に使えない理由。**使えるなら `undefined`。**
 *
 * **選べたことと、使えることは別**（2026-09-12・実測）。本体を最小化したまま探すと、
 * `sshboard` では **16x16 の道具窓だけが残った。**そのまま進むと 16x16 の絵が証跡に残り、
 * **人は検証したつもりになる。**「見つからない」ではなく「**人が見ている窓ではない**」と言う。
 */
export function whyUnusable(window: WinWindow): string | undefined {
  if (window.width >= MIN_HUMAN_SIZE && window.height >= MIN_HUMAN_SIZE) return undefined;

  return (
    `見つかった窓が小さすぎる（${String(window.width)}x${String(window.height)}）。` +
    'アプリが最小化されていないか、人が見ている窓が開いているかを確かめてください' +
    '（アプリが持つ目に見えない道具窓を掴んでいる可能性があります）'
  );
}

/**
 * いちばん大きい窓。**並んだら先に出た方**（同じ入力で選ぶ窓が毎回変われば、
 * 証跡の読み手はどちらを見たのか分からなくなる）。
 */
function biggest(found: readonly WinWindow[]): WinWindow | undefined {
  let best: WinWindow | undefined;
  for (const one of found) {
    if (best === undefined || one.width * one.height > best.width * best.height) best = one;
  }
  return best;
}
