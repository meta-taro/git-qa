import { describe, expect, it } from 'vitest';

import { compareToManual, measureRun, renderBench } from '../../src/run/bench.js';
import type { BenchRun } from '../../src/run/bench.js';

/**
 * **楽になったことを数字で示す**（Issue 008・C48・C117）。
 *
 * 所要時間と手数は、証跡（`run.json`）に既に残っている（ケースごとの開始・終了・判定の時刻、
 * 判定を置いた打鍵の回数、端末を触った回数）。**人が目で数え直さなくてよいように**、
 * 証跡から読み出して 1 枚にする。
 */

const at = (sec: number): string => new Date(Date.UTC(2026, 10, 9, 10, 0, sec)).toISOString();

const run: BenchRun = {
  runId: '20261109-100000',
  startedAt: at(0),
  finishedAt: at(100),
  cases: [
    {
      no: 1,
      title: 'ログインできる',
      startedAt: at(0),
      finishedAt: at(30),
      humanResult: 'VERIFIED',
      verifiedAt: at(30),
      steps: [{ at: at(2) }, { at: at(10) }],
      humanInputs: { verdict: 1, advance: 0 },
    },
    {
      no: 2,
      title: 'メモを保存できる',
      startedAt: at(30),
      finishedAt: at(50),
      // 人は見送った（判定を置かず送った）
      steps: [{ at: at(35) }],
      humanInputs: { verdict: 0, advance: 1 },
    },
    {
      no: 3,
      title: 'メモを削除できる',
      startedAt: at(50),
      finishedAt: at(100),
      humanResult: 'FAIL',
      verifiedAt: at(100),
      steps: [{ at: at(55) }, { at: at(60) }],
      humanActions: [{ at: at(70) }, { at: at(75) }],
      humanInputs: { verdict: 2, advance: 0 },
    },
  ],
};

describe('measureRun', () => {
  const bench = measureRun(run);

  it('件数・人が置いた件数・走り切ったかを出す', () => {
    expect(bench.runId).toBe('20261109-100000');
    expect(bench.finished).toBe(true);
    expect(bench.cases).toBe(3);
    expect(bench.placed).toBe(2);
  });

  it('所要時間は始まりから終わりまで（wall clock・AI の思考や待ちを外さない・C48）', () => {
    expect(bench.totalMs).toBe(100_000);
  });

  it('1 件あたりの平均と中央値を出す', () => {
    expect(bench.perCaseMs).toEqual({ mean: 100_000 / 3, median: 30_000 });
  });

  it('AI が操作していた時間と、人の番だった時間を分ける', () => {
    // AI: 最初の操作まで含めて、最後の操作の時刻まで（No.1: 10 秒・No.2: 5 秒・No.3: 10 秒）
    expect(bench.aiMs).toBe(25_000);
    // 人の番: 最後の操作から判定を置くまで（No.1: 20 秒・No.3: 40 秒。No.2 は置いていない）
    expect(bench.humanMs).toBe(60_000);
    expect(bench.humanMeasured).toBe(2);
  });

  it('手数は証跡から数える（判定・送り・端末を触った回数）。置き直したケースを挙げる', () => {
    expect(bench.inputs).toEqual({ verdict: 3, advance: 1, touches: 2 });
    expect(bench.redone).toEqual([3]);
  });

  it('いちばん長かったケースを挙げる', () => {
    expect(bench.longest).toMatchObject({ no: 3, title: 'メモを削除できる', totalMs: 50_000 });
  });

  it('ケースが 1 件も無ければ、平均も最長も無い', () => {
    const empty = measureRun({ ...run, cases: [] });
    expect(empty.perCaseMs).toBeUndefined();
    expect(empty.longest).toBeUndefined();
    expect(empty.humanMeasured).toBe(0);
  });
});

describe('measureRun — 途中で止まった実行', () => {
  const stopped: BenchRun = {
    ...run,
    finishedAt: undefined,
    cases: [run.cases[0]!, { ...run.cases[1]!, finishedAt: undefined }],
  };
  const bench = measureRun(stopped);

  it('走り切っていないと言い、所要は終わっているケースの最後までで数える', () => {
    expect(bench.finished).toBe(false);
    expect(bench.totalMs).toBe(30_000);
  });

  it('終わっていないケースは、1 件あたりの数にも最長にも入れない', () => {
    expect(bench.perCaseMs).toEqual({ mean: 30_000, median: 30_000 });
    expect(bench.longest?.no).toBe(1);
  });

  it('終わったケースが 1 件も無ければ、所要は出さない', () => {
    const none = measureRun({
      ...stopped,
      cases: [{ ...run.cases[0]!, finishedAt: undefined }],
    });
    expect(none.totalMs).toBeUndefined();
  });
});

describe('compareToManual — C48 の線', () => {
  it('0.70 以下は合格', () => {
    expect(compareToManual(28 * 60_000, 40 * 60_000)).toEqual({ ratio: 0.7, verdict: 'pass' });
    expect(compareToManual(10 * 60_000, 40 * 60_000).verdict).toBe('pass');
  });

  it('0.70 超〜1.00 は不合格（短いが明確ではない）', () => {
    expect(compareToManual(30 * 60_000, 40 * 60_000).verdict).toBe('fail');
    expect(compareToManual(40 * 60_000, 40 * 60_000).verdict).toBe('fail');
  });

  it('1.00 超は、道具のほうが遅い', () => {
    expect(compareToManual(41 * 60_000, 40 * 60_000).verdict).toBe('slower');
  });

  it('手作業の時間が 0 以下なら比べられない', () => {
    expect(() => compareToManual(1, 0)).toThrow(/手作業/);
  });
});

describe('renderBench', () => {
  it('件数・所要・内訳・手数・最長を、人が読める行にする', () => {
    const text = renderBench(measureRun(run));
    expect(text).toContain('証跡 20261109-100000: 3 件（人が置いた 2 件）');
    expect(text).toContain('所要: 1 分 40 秒（1 件あたり 平均 33.3 秒・中央値 30.0 秒）');
    expect(text).toContain(
      'AI が操作していた時間 25.0 秒、人の番だった時間 1 分 00 秒（判定を置いた 2 件）',
    );
    expect(text).toContain(
      '手数: 判定 3 回・送り 1 回・端末を触った 2 回（置き直したケース: No. 3）',
    );
    expect(text).toContain('いちばん長かったケース: No. 3「メモを削除できる」50.0 秒');
  });

  it('途中で止まった実行なら、そう言う（#38 と同じ言い方）', () => {
    const text = renderBench(measureRun({ ...run, finishedAt: undefined }));
    expect(text).toContain('この実行は途中で止まっている（終わりの時刻が無い）');
  });

  it('20 件に満たなければ、1 ケースの当たり外れが全体を動かすと添える（C48）', () => {
    expect(renderBench(measureRun(run))).toContain('20 件に満たない');
  });

  it('手作業の時間を渡すと、比と C48 の判定と注記を出す', () => {
    const text = renderBench(measureRun(run), 5 * 60_000);
    expect(text).toContain('手作業: 5 分 00 秒');
    expect(text).toContain('道具 ÷ 手作業 = 0.33');
    expect(text).toContain('合格（C48 の線: 0.70 以下）');
    expect(text).toContain('手作業側は道具を知っている人が実施');
  });

  it('所要が出せない証跡（終わったケースが無い）では、比を出さない', () => {
    const none = measureRun({
      ...run,
      finishedAt: undefined,
      cases: [{ ...run.cases[0]!, finishedAt: undefined }],
    });
    const text = renderBench(none, 5 * 60_000);
    expect(text).toContain('所要: 出せない（終わったケースが無い）');
    expect(text).not.toContain('道具 ÷ 手作業');
  });
});
