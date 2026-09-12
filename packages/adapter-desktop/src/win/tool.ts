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
