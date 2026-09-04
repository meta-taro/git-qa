/**
 * git-qa 自身の窓を撮る。**AI が自分の画面を見るための口。**
 *
 * これが無いと、AI は「右のカラムに何が出ていますか」と人へ聞くしかない。
 * 実際に 2 度聞き、そのあいだに人が置いた判定が消えた（2026-09-04）。
 * **人に目の代わりをさせない。**
 *
 * 端末の画面を撮る `device_screenshot` とは別物。あちらは検証の対象、こちらは道具自身。
 */

/**
 * 画面収録の許可があるか、OS へ直接聞く。
 *
 * **`screencapture` は許可が無くてもエラーを返さない。**実測（2026-09-04）:
 * `exit=0`・stderr は空・PNG は 4.3 MB。**窓を全部消した絵**が返る。
 * 3 回撮って 3 回とも壁紙だけが返り、危うく「窓が出ていない」と報告するところだった。
 *
 * **見えない道具より、嘘をつく道具のほうが悪い。**そこで撮る前に聞く。
 *
 * 聞いているのは `osascript` 自身の許可だが、TCC は責任を持つプロセス（端末やアプリ）に
 * ひも付くので、同じ親から起きているこちらの許可と一致する。
 */
export function screenCaptureAllowedScript(): string {
  return (
    'ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []]); ' +
    '$.CGPreflightScreenCaptureAccess()'
  );
}

/** 返事を読む。**読めないものは「分からない」**にして、撮ること自体は止めない。 */
export function parseAllowed(stdout: string): boolean | undefined {
  const answer = stdout.trim();
  if (answer === 'true') return true;
  if (answer === 'false') return false;
  return undefined;
}

/** 許可が無いときに出す文。**どこで許可するか、何が要るかまで言う。** */
const DENIED =
  '画面収録の許可が無い。このままだと macOS は、エラーを返さずに' +
  '**窓を全部消した絵**（壁紙だけ）を返す。' +
  'システム設定 → プライバシーとセキュリティ → 画面収録 で、' +
  'この道具を動かしているアプリ（ターミナル等）を許可する。' +
  '**許可したあと、そのアプリを一度終了して開き直すまで効かない。**';

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 窓の位置と大きさを聞く AppleScript。
 *
 * **アプリ名をそのまま埋め込まない。**引用符を閉じられると、その先が別の命令になる
 * （product-baseline §21「ユーザー入力を信用しない」）。
 */
export function boundsScript(app: string): string {
  const safe = app.replace(/[^A-Za-z0-9 ._-]/g, '');
  return [
    'tell application "System Events"',
    `  if not (exists process "${safe}") then return "missing value"`,
    `  tell process "${safe}"`,
    '    if (count of windows) is 0 then return "missing value"',
    '    set p to position of window 1',
    '    set s to size of window 1',
    '    return (item 1 of p as text) & ", " & (item 2 of p as text) & ", " & (item 1 of s as text) & ", " & (item 2 of s as text)',
    '  end tell',
    'end tell',
  ].join('\n');
}

/** `12, 34, 800, 600` を読む。**当て推量で撮らない**ので、読めなければ undefined。 */
export function parseBounds(stdout: string): WindowBounds | undefined {
  const numbers = stdout
    .trim()
    .split(',')
    .map((part) => Number(part.trim()));
  if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) return undefined;
  const [x, y, width, height] = numbers as [number, number, number, number];
  // 大きさの無い窓は撮れない（畳まれている・出来かけ）。
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

/** `-x` 無音・`-o` 影なし。**窓の範囲だけ**を撮る（他のアプリを写さない）。 */
export function captureArgs(bounds: WindowBounds, path: string): string[] {
  const { x, y, width, height } = bounds;
  return ['-x', '-o', '-R', `${String(x)},${String(y)},${String(width)},${String(height)}`, path];
}

export interface Screenshot {
  readonly mimeType: 'image/png';
  readonly base64: string;
}

export interface WindowCaptureOptions {
  readonly run: (command: string, args: readonly string[]) => Promise<string>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly tmpPath: () => string;
}

/**
 * 撮る範囲。
 *
 * **窓だけを撮るにはアクセシビリティの許可が要る**（窓の位置を聞くため）。
 * 許可が無い機械でも、画面全体なら撮れる（画面収録の許可だけで足りる）。
 */
export type CaptureMode = 'window' | 'screen';

export function createWindowCapture(
  options: WindowCaptureOptions,
): (app: string, mode?: CaptureMode) => Promise<Screenshot> {
  const shoot = async (args: readonly string[]): Promise<Screenshot> => {
    await options.run('screencapture', args);
    const path = args[args.length - 1] as string;
    return {
      mimeType: 'image/png',
      base64: Buffer.from(await options.readFile(path)).toString('base64'),
    };
  };

  return async (app: string, mode: CaptureMode = 'window'): Promise<Screenshot> => {
    // **撮る前に聞く。**許可が無いと、嘘の絵が黙って返る。
    let allowed: boolean | undefined;
    try {
      allowed = parseAllowed(
        await options.run('osascript', ['-l', 'JavaScript', '-e', screenCaptureAllowedScript()]),
      );
    } catch {
      // 聞けないだけ。**確かめられないことを理由に手を止めない**（古い macOS・macOS 以外）。
      allowed = undefined;
    }
    if (allowed === false) throw new Error(DENIED);

    const path = options.tmpPath();
    // 画面全体は、窓の位置を聞かずに撮れる（アクセシビリティの許可が要らない）。
    if (mode === 'screen') return shoot(['-x', '-o', path]);

    let stdout: string;
    try {
      stdout = await options.run('osascript', ['-e', boundsScript(app)]);
    } catch (error: unknown) {
      // **握り潰さない。**何の許可が足りないのかを言う。言わないと人は動けない。
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `窓の位置を聞けない（アクセシビリティの許可が要る。` +
          `システム設定 → プライバシーとセキュリティ → アクセシビリティ）。` +
          `画面全体でよければ mode に screen を指定する。元の理由: ${detail}`,
      );
    }

    const bounds = parseBounds(stdout);
    if (bounds === undefined) {
      // **黙って空の絵を返さない。**撮れなかったことと、何も出ていないことは別。
      throw new Error(`窓が見つからない: ${app}（起動しているかを確かめる）`);
    }
    return shoot(captureArgs(bounds, path));
  };
}
