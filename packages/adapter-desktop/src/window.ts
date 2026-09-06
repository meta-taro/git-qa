/**
 * 見る窓を決めて、撮る（C55 / Issue 016）。
 *
 * **見るほうは段が要らない。**どのアプリでも同じ手で撮れる
 * （実測 2026-09-06: 118 ms / 枚・約 8.5 fps・737 KB / 枚）。
 * 段が要るのは**触るほう**だけ（`ax.ts` → `ocr.ts` → 座標）。
 */

/** 窓 1 つ。位置と大きさは、絵の中の座標を画面の座標へ戻すのに要る。 */
export interface WindowRef {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 窓の番号と位置を聞く JXA。
 *
 * **アプリ名をそのまま埋め込まない**（product-baseline §21）。`JSON.stringify` で閉じる。
 * これなら `計算機` のような日本語の名前も落とさずに渡せる。
 *
 * `kCGWindowListOptionOnScreenOnly`（1）は**手前から奥の順**で返るので、最初の 1 つが最前面。
 * `kCGWindowLayer === 0` で普通の窓だけに絞る（メニューバー・Dock・影を掴まない）。
 */
export function windowScript(app: string): string {
  return [
    'ObjC.bindFunction("CGWindowListCopyWindowInfo", ["id", ["unsigned int", "unsigned int"]]);',
    `var want = ${JSON.stringify(app)};`,
    'var list = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(1, 0));',
    'var hit = list.filter(function (w) {',
    '  return w.kCGWindowOwnerName === want && w.kCGWindowLayer === 0',
    '    && w.kCGWindowBounds.Width > 1 && w.kCGWindowBounds.Height > 1;',
    '})[0];',
    'hit',
    '  ? [hit.kCGWindowNumber, hit.kCGWindowBounds.X, hit.kCGWindowBounds.Y,',
    '     hit.kCGWindowBounds.Width, hit.kCGWindowBounds.Height].join(", ")',
    '  : "missing value";',
  ].join('\n');
}

/** `217, 100, 50, 800, 600` を読む。**当て推量で撮らない**ので、読めなければ undefined。 */
export function parseWindow(stdout: string): WindowRef | undefined {
  const numbers = stdout
    .trim()
    .split(',')
    .map((part) => Number(part.trim()));
  if (numbers.length !== 5 || numbers.some((n) => !Number.isFinite(n))) return undefined;

  const [id, x, y, width, height] = numbers as [number, number, number, number, number];
  // 大きさの無い窓は撮れない（畳まれている・出来かけ）。
  if (id <= 0 || width <= 0 || height <= 0) return undefined;
  return { id, x, y, width, height };
}

/**
 * `-x` 無音・`-o` 影なし・`-t jpg`・`-l` **窓そのもの**を撮る。
 *
 * **`-R x,y,w,h`（画面の四角）を使わない。**2026-09-04、`app_screenshot` が四角で撮っていて、
 * 手前に重なった別アプリが写った。**同じ間違いをここで繰り返さない。**
 */
export function captureArgs(windowId: number, path: string): string[] {
  return ['-x', '-o', '-t', 'jpg', '-l', String(windowId), path];
}
