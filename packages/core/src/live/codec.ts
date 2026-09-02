/**
 * 端末が吐いた SPS から、復号器へ渡す codec 文字列を組み立てる。
 *
 * **固定にしてはいけない。**端末の解像度で level が変わる。食い違うと復号器は
 * 1 枚も返さず、画面は真っ黒のまま黙る（実機で起きた。端末は Level 5.0、
 * こちらは Level 3.0 固定だった）。
 *
 * 形は `avc1.PPCCLL`（profile_idc / constraint flags / level_idc を 16 進で並べたもの）。
 */

const SPS_NAL_TYPE = 7;

/** 開始コード（`00 00 01` / `00 00 00 01`）の直後の位置を順に返す。 */
function* nalStarts(bytes: Uint8Array): Generator<number> {
  for (let i = 0; i + 2 < bytes.length; i += 1) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0) continue;
    if (bytes[i + 2] === 1) {
      yield i + 3;
      continue;
    }
    if (bytes[i + 2] === 0 && bytes[i + 3] === 1) yield i + 4;
  }
}

const hex = (value: number): string => value.toString(16).padStart(2, '0');

/**
 * @returns `avc1.42c032` のような文字列。SPS が無ければ `undefined`。
 * **見つからないときに既定値を返さない。**間違った値で復号器を作ると、原因が隠れる。
 */
export function codecFromAnnexB(bytes: Uint8Array): string | undefined {
  for (const start of nalStarts(bytes)) {
    const header = bytes[start];
    if (header === undefined || (header & 0x1f) !== SPS_NAL_TYPE) continue;

    const profile = bytes[start + 1];
    const constraint = bytes[start + 2];
    const level = bytes[start + 3];
    // 途中で切れている。**組み立てられないなら、組み立てない。**
    if (profile === undefined || constraint === undefined || level === undefined) return undefined;

    return `avc1.${hex(profile)}${hex(constraint)}${hex(level)}`;
  }
  return undefined;
}
