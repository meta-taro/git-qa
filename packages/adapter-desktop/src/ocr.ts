/**
 * 触れ方の**段 2** —— 絵から文字を読む（C55）。
 *
 * **段 1（アクセシビリティ）が空でも諦めないための道。**自分で画面を描くアプリは
 * 部品を何も名乗らないが、**人が読める文字は画面に出ている。**そこを読む。
 *
 * 読むのは **OS が持っている Vision**。外部の依存は足さない（C54 と同じ考え方）。
 * 呼び出しは `xcrun swiftc` で作った小さな実行ファイル 1 つ（`tools/ocr.swift`）。
 *
 * **読み違える前提で作る。**実測（2026-09-06）で `書きました` を `響きました` と読んだ。
 * ただし**外れる方向は安全** —— 期待した文字が「見つからない」になり、
 * `BLOCKED` か `FAIL` として人の目に回る。**通ってはいけないものが通る側には倒れない。**
 */

/** 読めた文字 1 つと、その真ん中（絵の中の画素）。 */
export interface OcrLine {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /**
   * その文字の大きさ。**指す矢印を文字の外へ置くのに要る**
   * （2026-09-08「カレンダーならかぶっちゃだめでしょ」）。
   * **古い道具は返さない**ので、無いことがある。
   */
  readonly width?: number;
  readonly height?: number;
}

/** `文字<TAB>x<TAB>y` を 1 行ずつ読む。**半端な行は捨てる。** */
export function parseOcr(stdout: string): OcrLine[] {
  const found: OcrLine[] = [];
  for (const line of stdout.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const text = parts[0] as string;
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    if (text === '' || !Number.isFinite(x) || !Number.isFinite(y)) continue;

    // **大きさは無いことがある**（古い道具は 3 つしか返さない）。無くても捨てない。
    const width = Number(parts[3]);
    const height = Number(parts[4]);
    const size =
      Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? { width, height }
        : {};

    found.push({ text, x, y, ...size });
  }
  return found;
}

export interface Point {
  readonly x: number;
  readonly y: number;
  /** 見つけたものの大きさ。**無いことがある**（絵から読んだ道具が古い場合）。 */
  readonly width?: number;
  readonly height?: number;
}

/**
 * 空白を落として比べる。
 *
 * **OCR は空白を混ぜて読む。**そこで落とすと、人が毎回シートを直すことになる。
 * 実測で `保 存` のように字の間へ空白が入った。
 */
const squeeze = (value: string): string => value.replace(/\s+/g, '');

/** 読めた文字から触る場所を決める。完全一致を先に見て、無ければ含むもの。 */
export function findInOcr(lines: readonly OcrLine[], ref: string): Point | undefined {
  const want = squeeze(ref);

  const of = (line: OcrLine): Point => ({
    x: line.x,
    y: line.y,
    ...(line.width === undefined ? {} : { width: line.width }),
    ...(line.height === undefined ? {} : { height: line.height }),
  });

  const exact = lines.find((line) => squeeze(line.text) === want);
  if (exact !== undefined) return of(exact);

  const partial = lines.find((line) => squeeze(line.text).includes(want));
  return partial === undefined ? undefined : of(partial);
}
