/**
 * **ページの表示領域の大きさを、シートが決める**（2026-11-26・C122）。
 *
 * ウェブの実行は 1280x900 の窓で固定だった。**利用者の大半がスマホのサイトでは、
 * 主な画面（390 幅）が検証から漏れる。**
 *
 * 合わせるのは窓ではなく**表示領域（viewport）そのもの**。窓の大きさで 390 を作ろうとすると、
 * ブラウザの最小幅で止まって 500 前後になる。表示領域を直接合わせれば、窓はそのままでよい。
 *
 * **`# 待つ:` と同じ考え方で、シートの見出しに書く。**実行のたびに変わる値がシートの外にあると、
 * 証跡を読んだ人が「この崩れはどの幅のものか」を復元できない（C40）。
 * **引数（`--viewport`）でも渡せる**のは、同じシートを CI で複数の幅に当てるため。
 * 渡した大きさは証跡の `target.viewport` に残る。
 */

/** シートの見出し。`# 画面: 390x844` / `# 画面: 390x844, 1440x900` */
export const VIEWPORT_KEY = '画面';

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * **下限と上限。**打ち間違い（`39x844`・`390x8440`）で見当違いの大きさにしない。
 * 200 は実在する最小のスマホ幅より十分小さく、7680 は 8K の横幅。
 */
const MIN_SIDE = 200;
const MAX_SIDE = 7680;

const bad = (said: string, why: string): Error =>
  new Error(
    `シートの見出し「# ${VIEWPORT_KEY}:」が読めない: ${said}。${why}` +
      `（例 390x844 / 390x844, 1440x900。各辺は ${String(MIN_SIDE)}〜${String(MAX_SIDE)}）`,
  );

/** 全角の数字・`×`・`Ｘ` を半角に寄せる。**人の書き方の違いで止めない。** */
const normalize = (text: string): string =>
  text
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[×Ｘｘ]/g, 'x')
    .replace(/X/g, 'x');

/**
 * `390x844, 1440x900` を読む。
 *
 * **読めないものは投げる**（C20）。黙って既定に落とすと、
 * 「390 で見るつもりで 1280 だった」が起きて、**それがいちばん気づけない。**
 */
export function parseViewports(said: string): Viewport[] {
  const trimmed = said.trim();
  if (trimmed === '') throw bad(said, '何も書かれていない');

  const parts = normalize(trimmed)
    .split(/[,、]|\s+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

  const viewports: Viewport[] = [];
  for (const part of parts) {
    const matched = /^(\d+)x(\d+)$/.exec(part);
    if (matched === null)
      throw bad(said, `「${part}」が 幅x高さ の形でない（390x844 のように書く）`);
    const width = Number(matched[1]);
    const height = Number(matched[2]);
    for (const side of [width, height]) {
      if (side < MIN_SIDE) throw bad(said, `${String(side)} は ${String(MIN_SIDE)} より小さい`);
      if (side > MAX_SIDE) throw bad(said, `${String(side)} は ${String(MAX_SIDE)} より大きい`);
    }
    const viewport = { width, height };
    if (viewports.some((seen) => seen.width === width && seen.height === height)) {
      throw bad(said, `${viewportLabel(viewport)} が 2 回ある`);
    }
    viewports.push(viewport);
  }
  return viewports;
}

/**
 * `# 画面:` を読む。**書いていなければ `undefined`**（既定のまま・既存のシートは変えずに動く）。
 */
export function sheetViewports(meta: Record<string, string>): Viewport[] | undefined {
  const said = meta[VIEWPORT_KEY]?.trim();
  if (said === undefined || said === '') return undefined;
  return parseViewports(said);
}

/** 証跡のフォルダ名・画面に出す形。`390x844`。 */
export function viewportLabel(viewport: Viewport): string {
  return `${String(viewport.width)}x${String(viewport.height)}`;
}
