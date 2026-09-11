import { describe, expect, it } from 'vitest';

import { exePathScript, fingerprintOf } from '../src/fingerprint.js';

/**
 * **相手が走行中に変わったかを測る**（外部レビュー meta-taro/git-qa#3）。
 *
 * デスクトップアプリなら、**窓の持ち主の実行ファイル**を見る。
 * 大きさと更新時刻が変われば、別のビルドになっている。
 *
 * **完全ではない。**中身だけ差し替わるホットリロードは、実行ファイルを変えない。
 * だからこれは「変わったら分かる」であって「**変わっていないことの保証**」ではない。
 * そこを取り違えないよう、返すのは**指紋の文字列だけ**にして、
 * 「同じ」と言うかどうかは `compareFingerprint` に任せる。
 */
describe('exePathScript', () => {
  it('プロセス番号から実行ファイルの場所を聞く', () => {
    const script = exePathScript(1398);

    expect(script).toContain('1398');
  });
});

describe('fingerprintOf', () => {
  it('場所と大きさと更新時刻を 1 本にする', () => {
    const print = fingerprintOf(
      '/A/x.app/Contents/MacOS/x',
      1234,
      new Date('2026-09-11T10:00:00Z'),
    );

    expect(print).toContain('/A/x.app/Contents/MacOS/x');
    expect(print).toContain('1234');
    expect(print).toContain('2026-09-11T10:00:00.000Z');
  });

  /** **同じものは同じ文字列になる。**でないと、毎回「変わった」と言うことになる。 */
  it('同じ入力なら同じ文字列', () => {
    const at = new Date('2026-09-11T10:00:00Z');

    expect(fingerprintOf('/a', 1, at)).toBe(fingerprintOf('/a', 1, at));
  });

  it('どれか 1 つ変われば、別の文字列', () => {
    const at = new Date('2026-09-11T10:00:00Z');

    expect(fingerprintOf('/a', 1, at)).not.toBe(fingerprintOf('/a', 2, at));
    expect(fingerprintOf('/a', 1, at)).not.toBe(fingerprintOf('/b', 1, at));
  });
});
