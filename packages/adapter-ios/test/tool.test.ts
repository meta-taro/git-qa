import { describe, expect, it } from 'vitest';

import { framesFrom, iosArgs, parseIosToolDevices } from '../src/tool.js';

/**
 * **iPhone / iPad を USB 越しに映す**（2026-09-19・人の指示）。
 *
 * > Android を接続して検証録画できるように、iPhone,iPad の検証録画も必要です
 *
 * **押す口はまだ無い。**iOS を押すには端末側にアプリ（WebDriverAgent）が要り、
 * 署名が要る＝人の作業（§14）。**見る・読むだけを持つ。**
 *
 * **実機でまだ 1 行も測っていない**（C56）。ここで試すのは、
 * **道具との受け渡しの形**だけ —— そこは端末が無くても決まる。
 */
describe('parseIosToolDevices', () => {
  it('識別子・名前・機種を 1 行 1 台で読む', () => {
    const said = parseIosToolDevices(
      ['00008120-001\tめたの iPhone\tiPhone14,5', '00008103-002\t検証用 iPad\tiPad13,1'].join('\n'),
    );

    expect(said).toEqual([
      { id: '00008120-001', name: 'めたの iPhone', model: 'iPhone14,5' },
      { id: '00008103-002', name: '検証用 iPad', model: 'iPad13,1' },
    ]);
  });

  it('空の出力は 0 台（「測れなかった」と混ぜない）', () => {
    expect(parseIosToolDevices('')).toEqual([]);
    expect(parseIosToolDevices('\n\n')).toEqual([]);
  });

  it('列が足りない行は落とす（当て推量で台数を増やさない）', () => {
    expect(parseIosToolDevices('00008120-001\tめたの iPhone')).toEqual([]);
  });
});

describe('iosArgs', () => {
  it('端末を指さないときは - を渡す（最初に見つかったものを使う）', () => {
    expect(iosArgs.shoot(undefined, '/tmp/a.jpg')).toEqual(['shoot', '-', '/tmp/a.jpg']);
  });

  it('端末を指すときは識別子を渡す', () => {
    expect(iosArgs.stream('00008120-001')).toEqual(['stream', '00008120-001']);
  });
});

/**
 * **絵は「長さを先に書いてから中身」で流れてくる。**
 *
 * 境界を探させない —— **JPEG の中に区切り文字が出ても壊れない形**にしてある。
 * 受け取る側は**分割されて届く**（TCP でもパイプでも）ので、そこを吸収する。
 */
describe('framesFrom', () => {
  const chunks = (...parts: Uint8Array[]): AsyncIterable<Uint8Array> => ({
    [Symbol.asyncIterator]() {
      let at = 0;
      return {
        next: () =>
          Promise.resolve(
            at < parts.length
              ? { value: parts[at++] as Uint8Array, done: false }
              : { value: undefined as unknown as Uint8Array, done: true },
          ),
      };
    },
  });
  const wire = (...frames: number[][]): Uint8Array => {
    const parts: number[] = [];
    for (const frame of frames) {
      for (const code of new TextEncoder().encode(`${String(frame.length)}\n`)) parts.push(code);
      parts.push(...frame);
    }
    return new Uint8Array(parts);
  };

  const collect = async (source: AsyncIterable<Uint8Array>): Promise<number[][]> => {
    const out: number[][] = [];
    for await (const frame of framesFrom(source)) out.push([...frame]);
    return out;
  };

  it('1 枚ずつ取り出す', async () => {
    expect(await collect(chunks(wire([1, 2, 3], [4, 5])))).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it('分割されて届いても組み立てる（長さの途中で切れても）', async () => {
    const whole = wire([7, 8, 9]);
    const parts = [whole.slice(0, 1), whole.slice(1, 3), whole.slice(3)];

    expect(await collect(chunks(...parts))).toEqual([[7, 8, 9]]);
  });

  it('1 枚に満たないまま終わったら、その分は出さない（欠けた絵を描かせない）', async () => {
    const whole = wire([1, 2, 3, 4]);

    expect(await collect(chunks(whole.slice(0, 4)))).toEqual([]);
  });

  it('長さが数でない行が来たら止める（境界を見失ったまま読み進めない）', async () => {
    const bad = new TextEncoder().encode('あ\n123');

    await expect(collect(chunks(bad))).rejects.toThrow(/長さ/);
  });
});
