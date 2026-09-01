/**
 * 生 H.264（Annex-B）の一本のストリームを、アクセスユニット（＝1 フレーム分）に切る。
 *
 * **ここはスパイクで 2 回壊れた場所**（`docs/adr/0002-live-view-embedding.md`）。
 * どちらも「フレームの切れ目をどこと見るか」の判定漏れで、しかも**再生が止まる形でしか
 * 表に出なかった**。だから使い捨てのコードから製品側へ移して、テストで固定する。
 *
 * 1. **1 フレームが複数スライスに割れる。**「スライスが来た＝次のフレーム」と数えると
 *    枚数が水増しされ、1 枚に満たない塊を復号器へ渡して落ちる
 * 2. **パラメータセット（SPS / PPS）は次のフレームのもの。**直前のユニットへ足すと、
 *    末尾にパラメータセットがぶら下がった塊になる。**Chromium は通すが WebKit は落ちる**
 */

export interface AccessUnit {
  /** 開始コードを含んだ、そのままの並び。復号器へ渡せる形。 */
  readonly bytes: Uint8Array;
  /** IDR を含むか。復号器の chunk の種別（key / delta）になる。 */
  readonly isKey: boolean;
}

export interface AnnexBSplitter {
  /** 受け取った分を切る。切りきれない末尾は内部に残す。 */
  push(chunk: Uint8Array): AccessUnit[];
  /** ストリームの終わりで、残っている分を吐く。**呼ばないと最後の 1 枚が出ない。** */
  flush(): AccessUnit[];
}

/** NAL の種別。ここで使うものだけ名前を付ける。 */
const NAL_SLICE_NON_IDR = 1;
const NAL_SLICE_IDR = 5;
const NAL_SEI = 6;
const NAL_SPS = 7;
const NAL_PPS = 8;
const NAL_AUD = 9;

/** 開始コード（00 00 01）の位置。3 バイト形式と 4 バイト形式のどちらも先頭は同じ。 */
function startCodeAt(buf: Uint8Array, from: number): number {
  for (let i = from; i + 2 < buf.length; i += 1) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) return i;
  }
  return -1;
}

/** NAL ヘッダの位置。開始コードが 3 バイトか 4 バイトかで 1 つずれる。 */
function headerOffset(nal: Uint8Array): number {
  return nal[2] === 1 ? 3 : 4;
}

function nalType(nal: Uint8Array): number {
  return (nal[headerOffset(nal)] ?? 0) & 0x1f;
}

function isSlice(type: number): boolean {
  return type === NAL_SLICE_NON_IDR || type === NAL_SLICE_IDR;
}

/**
 * そのスライスがフレームの先頭か。
 *
 * スライスヘッダの最初は `first_mb_in_slice`（ue(v)）。値が 0 なら最初のビットが 1 になる。
 * **割れていても境界を間違えない**のはこの判定のおかげ。
 */
function isFirstSlice(nal: Uint8Array): boolean {
  const at = headerOffset(nal) + 1;
  return ((nal[at] ?? 0) & 0x80) !== 0;
}

/** パラメータセットの類は「次のフレームのもの」。スライスの後に来たらそこが境界。 */
function startsNextUnit(type: number): boolean {
  return type === NAL_AUD || type === NAL_SEI || type === NAL_SPS || type === NAL_PPS;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function createAnnexBSplitter(): AnnexBSplitter {
  // 型注釈を付ける。`new Uint8Array(0)` から推論させると ArrayBuffer 固定になり、
  // `slice()` が返す ArrayBufferLike を入れられない。
  let pending: Uint8Array = new Uint8Array(0);
  let unit: Uint8Array[] = [];
  let unitHasSlice = false;

  const takeUnit = (): AccessUnit | undefined => {
    if (unit.length === 0) return undefined;
    const bytes = concat(unit);
    const isKey = unit.some((nal) => nalType(nal) === NAL_SLICE_IDR);
    unit = [];
    unitHasSlice = false;
    return { bytes, isKey };
  };

  const pushNal = (nal: Uint8Array, out: AccessUnit[]): void => {
    const type = nalType(nal);
    const boundary = (isSlice(type) && isFirstSlice(nal)) || startsNextUnit(type);
    if (boundary && unitHasSlice) {
      const done = takeUnit();
      if (done !== undefined) out.push(done);
    }
    unit.push(nal);
    if (isSlice(type)) unitHasSlice = true;
  };

  return {
    push(chunk) {
      const out: AccessUnit[] = [];
      const buf = concat([pending, chunk]);

      let at = startCodeAt(buf, 0);
      if (at < 0) {
        // 開始コードがまだ来ていない。またぐことがあるので捨てずに持つ。
        pending = buf;
        return out;
      }
      for (;;) {
        const next = startCodeAt(buf, at + 3);
        if (next < 0) {
          pending = buf.slice(at);
          return out;
        }
        pushNal(buf.slice(at, next), out);
        at = next;
      }
    },

    flush() {
      const out: AccessUnit[] = [];
      if (pending.length > 0 && startCodeAt(pending, 0) === 0) {
        pushNal(pending, out);
      }
      pending = new Uint8Array(0);
      const last = takeUnit();
      if (last !== undefined) out.push(last);
      return out;
    },
  };
}
