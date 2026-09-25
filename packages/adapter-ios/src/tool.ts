/**
 * `git-qa-ios`（Swift の道具）との受け渡し。
 *
 * **ここには端末が要らない。**道具が何を出すか・何を渡すかの形だけを持つので、
 * **実機が無くても決まるし、試験もできる。**
 *
 * 道具そのものは `tools/ios.swift`。**押す口は持っていない**
 * （WebDriverAgent が要る＝署名が要る＝人の作業・§14）。
 */

export interface IosDevice {
  /** 撮影機器としての識別子。**人に見せない**（機械を特定できる）。 */
  readonly id: string;
  /** 端末の名前。**人が付けるので日本語が入る。** */
  readonly name: string;
  /** 機種（`iPhone14,5` / `iPad13,1`）。**証跡に残すのはこちら。** */
  readonly model: string;
}

/** 道具が出す `識別子 \t 名前 \t 機種` を読む。**列が足りない行は落とす。** */
export function parseIosToolDevices(stdout: string): IosDevice[] {
  const out: IosDevice[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    const [id, name, model] = line.split('\t');
    if (id === undefined || name === undefined || model === undefined) continue;
    if (id.trim() === '' || model.trim() === '') continue;
    out.push({ id: id.trim(), name: name.trim(), model: model.trim() });
  }
  return out;
}

/** **端末を指さないときは `-`。**最初に見つかったものを使う。 */
const which = (device: string | undefined): string => device ?? '-';

/**
 * 流す間隔（ミリ秒）。**8 枚/秒。**
 *
 * **端末が出すまま全部は要らない**（2026-09-25・実機で測った）。
 * 絞らずに流したら **6 秒で 298 枚＝49.7 枚/秒・1 枚 104 KB・毎秒およそ 5 MB** だった。
 * 人が見て判断するのに 50 枚/秒は要らず、**橋と復号がその分だけ重くなる。**
 * デスクトップ（8 枚/秒）と揃える。
 */
export const IOS_FRAME_INTERVAL_MS = 125;

export const iosArgs = {
  devices: (): string[] => ['devices'],
  shoot: (device: string | undefined, path: string): string[] => ['shoot', which(device), path],
  /**
   * 撮り続けて流す。**間隔を渡す**（道具側で間引く）。
   *
   * **0 以下は受けない。**「絞らない」つもりの値が、そのまま割り算へ行くと壊れる。
   */
  stream: (device: string | undefined, intervalMs = IOS_FRAME_INTERVAL_MS): string[] => [
    'stream',
    which(device),
    String(intervalMs > 0 ? Math.round(intervalMs) : IOS_FRAME_INTERVAL_MS),
  ],
} as const;

const NEWLINE = 0x0a;

/**
 * **長さを先に書いてから中身**、で流れてくる絵を 1 枚ずつ取り出す。
 *
 *     <10 進の長さ>\n<JPEG のバイト列>
 *
 * **境界を探さない。**JPEG の中に区切り文字が出ても壊れない。
 * 届き方は**こちらの都合では決まらない**（分割されるし、長さの途中でも切れる）ので、
 * そこを吸収する。
 *
 * **1 枚に満たないまま終わったら、その分は出さない** —— 欠けた絵を描かせない。
 */
export async function* framesFrom(
  source: AsyncIterable<Uint8Array<ArrayBufferLike>>,
): AsyncIterable<Uint8Array> {
  // **器の種類は選べない。**Node の流れは `Buffer`（共有の器を指しうる）を渡してくる。
  let held: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  const join = (
    a: Uint8Array<ArrayBufferLike>,
    b: Uint8Array<ArrayBufferLike>,
  ): Uint8Array<ArrayBufferLike> => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  };

  for await (const chunk of source) {
    held = join(held, chunk);

    for (;;) {
      const at = held.indexOf(NEWLINE);
      if (at < 0) break;

      const said = new TextDecoder().decode(held.subarray(0, at));
      const size = Number(said);
      if (!Number.isInteger(size) || size < 0) {
        // **境界を見失ったまま読み進めない。**次の絵がどこから始まるか分からない。
        throw new Error(`絵の長さが読めない: ${said}`);
      }
      if (held.length < at + 1 + size) break;

      // **写して渡す。**`subarray` は元の器を共有するので、
      // 次の絵を継ぎ足したときに**渡した絵の中身が変わる。**
      yield new Uint8Array(held.subarray(at + 1, at + 1 + size));
      held = held.subarray(at + 1 + size);
    }
  }
}
