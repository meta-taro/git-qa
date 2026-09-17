import type { CaseRecording, RecordingControl } from '@git-qa/core';

/**
 * **人が見ていた映像を、そのまま証跡に残す**（meta-taro/git-qa#31）。
 *
 * > 全自動でテスト動画をとる場合、エージェントの操作は必須となります。
 *
 * ウェブと Windows には録画が無い。どちらも**ライブ映像は 1 枚ずつの絵**で流れているので、
 * **同じ絵を溜めて繋ぐ。**相手の画面そのものを録るので、**窓が要らない**
 * （無人で流すときにも録れる）。
 *
 * **録っていないことと、録れなかったことを混ぜない**（C20）。
 */

export interface FrameRecordingDeps {
  /** ケースごとの、絵の置き場所。 */
  readonly dirFor: (caseNo: number) => string;
  readonly ensureDir: (dir: string) => Promise<void>;
  readonly writeFrame: (path: string, bytes: Uint8Array) => Promise<void>;
  /** 絵を繋いで動画にする。**道具が無ければ `undefined`**（持っていない）。 */
  readonly toWebm: (
    dir: string,
    frames: number,
  ) => Promise<{ name: string; note?: string } | undefined>;
  /** 溜めた絵を片付ける。**残すと、証跡が数百枚の絵で埋まる。** */
  readonly removeFrames: (dir: string) => Promise<void>;
  readonly now: () => Date;
  /** 並びの速さ（枚/秒）。**長さを出すのに要る。** */
  readonly fps: number;
}

export interface FrameRecording extends RecordingControl {
  /** ライブ映像の 1 枚。**録っていないときは捨てる。** */
  accept(bytes: Uint8Array): void;
}

export function createFrameRecording(deps: FrameRecordingDeps): FrameRecording {
  let dir: string | undefined;
  let count = 0;
  /** 書き込みを順に並べる。**並びが崩れると、動画の順番が狂う。** */
  let queue: Promise<unknown> = Promise.resolve();

  return {
    requested: true,

    start(caseNo) {
      dir = deps.dirFor(caseNo);
      count = 0;
      queue = deps.ensureDir(dir);
      return queue.then(() => undefined);
    },

    accept(bytes) {
      // **頼まれるまでは溜めない。**捨てるだけ（ライブ映像は流れ続ける）。
      if (dir === undefined) return;
      count += 1;
      const at = `${dir}/${String(count).padStart(5, '0')}.jpg`;
      queue = queue.then(() => deps.writeFrame(at, bytes)).catch(() => undefined);
    },

    async stop(): Promise<CaseRecording> {
      const where = dir;
      const frames = count;
      dir = undefined;
      count = 0;

      // **頼まれていない。**「録れなかった」ではない（C20）。
      if (where === undefined) return { state: 'not_requested' };

      await queue.catch(() => undefined);

      // **1 枚も来ていないなら、動画は作らない。**空の webm を証跡に置かない。
      if (frames === 0) {
        return { state: 'failed', reason: '映像が 1 枚も来なかった（録画の中身が無い）' };
      }

      const made = await deps.toWebm(where, frames).catch(() => undefined);
      if (made === undefined) {
        // **道具が無いのは「持っていない」。**絵は残してある。
        return {
          state: 'unsupported',
          reason: `絵は ${String(frames)} 枚残したが、動画にする道具（ffmpeg）が無い`,
        };
      }

      // 繋いだあとは片付ける。**1 件ごとに数百枚が残ると、証跡が読めなくなる。**
      await deps.removeFrames(where).catch(() => undefined);
      /**
       * **長さは枚数から出す。**撮った時間そのものではないが、
       * **並びの速さが決まっている**ので、読む人には同じ意味になる。
       */
      const durationMs = Math.round((frames / deps.fps) * 1000);
      return { state: 'recorded', file: made.name, durationMs };
    },
  };
}
