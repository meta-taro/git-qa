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

/**
 * ある一点で**いちばん手前に居る窓**を聞く JXA。
 *
 * **撮るのと押すのでは、隠れの効き方が違う。**
 * 撮るほうは `screencapture -l <窓番号>` なので、重なっていても目的の窓だけが写る。
 * **押すほうは画面全体の座標で送るので、隠れていれば手前の別アプリが受け取る。**
 * そのとき返るのは「押せなかった」ではなく、**別のアプリが動いたという結果**になる。
 */
export function topWindowScript(x: number, y: number): string {
  return [
    'ObjC.bindFunction("CGWindowListCopyWindowInfo", ["id", ["unsigned int", "unsigned int"]]);',
    `var wantX = ${String(Math.round(x))};`,
    `var wantY = ${String(Math.round(y))};`,
    'var list = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(1, 0));',
    // 手前から奥の順で返るので、最初に当たったものがいちばん手前。
    'var hit = list.filter(function (w) {',
    '  var b = w.kCGWindowBounds;',
    '  return w.kCGWindowLayer === 0 && b.Width > 1 && b.Height > 1',
    '    && wantX >= b.X && wantX <= b.X + b.Width',
    '    && wantY >= b.Y && wantY <= b.Y + b.Height;',
    '})[0];',
    'hit ? [hit.kCGWindowNumber, hit.kCGWindowOwnerName].join(", ") : "missing value";',
  ].join('\n');
}

/** `217, Electron` を読む。**持ち主の名前にカンマが入ることがある**ので、最初の 1 つでだけ割る。 */
export function parseTopWindow(stdout: string): { id: number; owner: string } | undefined {
  const said = stdout.trim();
  const at = said.indexOf(',');
  if (at < 0) return undefined;

  const id = Number(said.slice(0, at).trim());
  const owner = said.slice(at + 1).trim();
  if (!Number.isFinite(id) || id <= 0 || owner === '') return undefined;
  return { id, owner };
}

/**
 * その点を押してよいかを決める。**押せないなら、なぜ押せないかを返す。**
 *
 * **勝手に前面へ出さない。**2026-09-06 に人からこう言われている:
 * 「チャット欄に書き込もうとしてフォーカス当てると、実際のアプリに移動しちゃうね」。
 * **検証は人の作業の上で走る。**奪うのではなく、止まって人に言う。
 */
export function occludedBy(
  expectedId: number,
  top: { id: number; owner: string } | undefined,
  app: string,
): string | undefined {
  if (top === undefined) {
    return `押そうとした場所に窓が無い（${app} が畳まれていないか、画面の外に出ていないかを見る）`;
  }
  if (top.id === expectedId) return undefined;

  return (
    `押そうとした場所は ${top.owner} が手前にあって隠している（見るほうは窓だけを撮るので、` +
    `映像には ${app} が写っている）。${app} を前面に出してから、もう一度置く。` +
    '（こちらからは前面に出さない —— 人が別の窓へ打っている最中に奪ってしまうため）'
  );
}

/**
 * 前面が目的のアプリかを確かめる。**押す直前の最後の関門。**
 *
 * 窓の一覧（`occludedBy`）だけでは足りなかった。
 * 2026-09-07、一覧が「連動くんが手前」と答えた点を押したのに、
 * 実際には Google Chrome のツールバーと warifu の窓を押していた。
 */
export function notFrontmost(app: string, frontmost: string): string | undefined {
  const front = frontmost.trim();
  if (front === '') return `いま前面に居るアプリが分からないので押さない（目的は ${app}）`;
  if (front === app) return undefined;

  return `${app} を前面に出せなかった（いま前面に居るのは ${front}）。押すと別のアプリが受け取る`;
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
