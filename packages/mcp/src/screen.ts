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

/**
 * 窓の番号（CGWindowID）を聞く JXA。
 *
 * 位置と大きさではなく**番号**を聞く。四角で切ると手前の窓が写り込むため（`captureArgs` の注記）。
 *
 * - `kCGWindowListOptionOnScreenOnly`（1）は**手前から奥の順**で返る。だから最初の 1 つが最前面
 * - `kCGWindowLayer === 0` で普通の窓だけに絞る。メニューバー・Dock・影は掴まない
 * - 1 ピクセルの窓を除く。畳まれた窓・出来かけの窓を掴むと、真っ白な絵が返る
 * - `kCGWindowOwnerName` は画面収録の許可が要らない（許可が要るのは `kCGWindowName` のほう）
 *
 * **アプリ名をそのまま埋め込まない。**引用符を閉じられると、その先が別の命令になる
 * （product-baseline §21「ユーザー入力を信用しない」）。`JSON.stringify` は JS の文字列
 * リテラルとして安全に閉じるので、`ターミナル` のような名前も落とさずに渡せる。
 */
export function windowIdScript(app: string): string {
  return [
    'ObjC.bindFunction("CGWindowListCopyWindowInfo", ["id", ["unsigned int", "unsigned int"]]);',
    `var want = ${JSON.stringify(app)};`,
    'var list = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(1, 0));',
    'var hit = list.filter(function (w) {',
    '  return w.kCGWindowOwnerName === want && w.kCGWindowLayer === 0',
    '    && w.kCGWindowBounds.Width > 1 && w.kCGWindowBounds.Height > 1;',
    '})[0];',
    'hit ? String(hit.kCGWindowNumber) : "missing value";',
  ].join('\n');
}

/** `217` を読む。**当て推量で撮らない**ので、番号になっていなければ undefined。 */
export function parseWindowId(stdout: string): number | undefined {
  const answer = stdout.trim();
  if (!/^\d+$/.test(answer)) return undefined;
  const id = Number(answer);
  // 0 は kCGNullWindowID（窓ではない）。これで撮ると画面全体が返る。
  return id > 0 ? id : undefined;
}

/** 許可が無いときに出す文。**どこで許可するか、何が要るかまで言う。** */
const DENIED =
  '画面収録の許可が無い。このままだと macOS は、エラーを返さずに' +
  '**窓を全部消した絵**（壁紙だけ）を返す。' +
  'システム設定 → プライバシーとセキュリティ → 画面収録 で、' +
  'この道具を動かしているアプリ（ターミナル等）を許可する。' +
  '**許可したあと、そのアプリを一度終了して開き直すまで効かない。**';

/**
 * `-x` 無音・`-o` 影なし・`-l` **窓そのもの**を撮る。
 *
 * **`-R x,y,w,h`（画面の四角）を使ってはいけない。**四角は画面の領域であって窓ではないので、
 * 手前に重なった別アプリがそのまま入る。2026-09-04、git-qa の絵として**別プロジェクトの
 * アプリの窓**が返った。エラーは出ない —— 前日の「許可が無いと壁紙が返る」と同じ、
 * **黙って違う絵を返す**壊れ方。証跡に残る絵であり、**リポジトリは public。**
 */
export function captureArgs(windowId: number, path: string): string[] {
  return ['-x', '-o', '-l', String(windowId), path];
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
 * 撮る範囲。窓だけを撮るか、画面全体を撮るか。
 *
 * どちらも要るのは**画面収録の許可だけ**。窓の番号を聞くのに追加の許可は要らない
 * （`kCGWindowOwnerName` は画面収録の許可の範囲内）。
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
    // 画面全体は、窓の番号を聞かずに撮れる。
    if (mode === 'screen') return shoot(['-x', '-o', path]);

    let stdout: string;
    try {
      stdout = await options.run('osascript', ['-l', 'JavaScript', '-e', windowIdScript(app)]);
    } catch (error: unknown) {
      // **握り潰さない。**何が起きたのかと、代わりの手を言う。言わないと人は動けない。
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `窓の番号を聞けない。画面全体でよければ mode に screen を指定する。元の理由: ${detail}`,
      );
    }

    const windowId = parseWindowId(stdout);
    if (windowId === undefined) {
      // **黙って空の絵を返さない。**撮れなかったことと、何も出ていないことは別。
      throw new Error(`窓が見つからない: ${app}（起動しているかを確かめる）`);
    }
    return shoot(captureArgs(windowId, path));
  };
}
