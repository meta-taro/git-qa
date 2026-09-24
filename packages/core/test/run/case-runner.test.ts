import { describe, expect, it } from 'vitest';

import type { TargetSession } from '../../src/adapter/types.js';
import { createFakeAdapter, type FakeAdapter } from '../../src/adapter/fake.js';
import type { CaseContext, CaseVerdict } from '../../src/run/execute.js';
import type { TsvRow } from '../../src/tsv/types.js';
import {
  EXPECTATION_COLUMN,
  STEPS_COLUMN,
  assertRunnableSheet,
  createSheetCaseRunner,
} from '../../src/run/case-runner.js';
import { parseTestSpecTsv } from '../../src/tsv/parse.js';

/**
 * ケース 1 件を実際に動かす所。
 *
 * **AI が PASS を出せるのは、期待結果が機械で見られるときだけ。**
 * それ以外は BLOCKED にして人へ渡す（Issue 004 の「判断保留」）。
 */

const context = (
  session: TargetSession,
  cells: Record<string, string>,
  steps: string[],
): CaseContext => ({
  subject: {
    no: 1,
    title: 'メモを保存できる',
    row: { index: 0, line: 12, cells, rawCells: cells, raw: '' },
  },
  session,
  step: (label?: string) => {
    steps.push(label ?? '');
  },
});

const connect = async (): Promise<{ adapter: FakeAdapter; session: TargetSession }> => {
  const adapter = createFakeAdapter({ kind: 'android' });
  return { adapter, session: await adapter.connect() };
};

/** act だけが落ちるセッション。端末側の失敗を、他を壊さずに真似る。 */
const failingAct = (session: TargetSession, error: Error): TargetSession => ({
  target: session.target,
  liveView: session.liveView,
  recording: session.recording,
  get isClosed() {
    return session.isClosed;
  },
  act: () => Promise.reject(error),
  observe: () => session.observe(),
  screenshot: () => session.screenshot(),
  close: () => session.close(),
});

/**
 * 偽の画面。**押す前は空、押したあとに文字が出る**（2026-09-24）。
 *
 * **前は押す前も後も同じ文字を返していた。**それだと
 * 「押す前から在る文字は確かめたことにならない」という守り（`wasAlreadyThere`）に
 * 引っかかる —— **引っかかるのが正しい。**実物の画面は、押して初めて変わる。
 *
 * **押す前の画面も見たい検査は、`before` を渡す。**
 */
const runner = (screenText: string | Error, before = '') => {
  let asked = 0;
  return createSheetCaseRunner({
    readScreenText: () => {
      // 1 回目は押す前。2 回目から押したあと。
      asked += 1;
      if (asked === 1) return Promise.resolve(before);
      return screenText instanceof Error ? Promise.reject(screenText) : Promise.resolve(screenText);
    },
    // **ここでは待たせない。**画面が変わらないことは分かっているので、
    // 落ちる判定のたびに本当に 2 秒待っても、確かめられることは増えない。
    expectation: { waitMs: 0, stepMs: 1 },
  });
};

describe('createSheetCaseRunner — 手順を実行して AI の判定を出す', () => {
  it('手順が全部落とせれば、順に操作する', async () => {
    const { adapter, session } = await connect();
    const steps: string[] = [];

    await runner('保存しました')(
      context(
        session,
        {
          [STEPS_COLUMN]: '1. 保存をタップする\n2. 完了をタップする',
          [EXPECTATION_COLUMN]: '「保存しました」と表示される',
        },
        steps,
      ),
    );

    expect(adapter.actions).toEqual([
      { kind: 'tap', target: { at: 'element', ref: '保存' } },
      { kind: 'tap', target: { at: 'element', ref: '完了' } },
    ]);
    // 足跡は手順の原文で残す。動画の頭出しに使う。
    expect(steps).toEqual(['保存をタップする', '完了をタップする']);
  });

  it('落とせない手順があれば、端末に触らずに BLOCKED を返す', async () => {
    const { adapter, session } = await connect();

    const verdict = await runner('')(
      context(
        session,
        {
          [STEPS_COLUMN]: '1. 保存をタップする\n2. メモを長押しする',
          [EXPECTATION_COLUMN]: '「あ」と表示される',
        },
        [],
      ),
    );

    expect(verdict.aiResult).toBe('BLOCKED');
    expect(verdict.note).toContain('メモを長押しする');
    // **途中まで触らない。**半分だけ操作した画面を人へ渡すと、どこから見ればよいか分からない。
    expect(adapter.actions).toEqual([]);
  });

  it('操作が落ちたら BLOCKED にし、どの手順で落ちたかを残す', async () => {
    const { session } = await connect();
    const broken = failingAct(session, new Error('要素が見つからない: 保存'));

    const verdict = await runner('')(
      context(
        broken,
        { [STEPS_COLUMN]: '保存をタップする', [EXPECTATION_COLUMN]: '「あ」と表示される' },
        [],
      ),
    );

    expect(verdict.aiResult).toBe('BLOCKED');
    expect(verdict.note).toContain('保存をタップする');
    expect(verdict.note).toContain('要素が見つからない: 保存');
  });

  it('期待結果の文字が画面に在れば PASS。何を見たかを残す', async () => {
    const { session } = await connect();

    const verdict = await runner('メモ一覧 保存しました')(
      context(
        session,
        {
          [STEPS_COLUMN]: '保存をタップする',
          [EXPECTATION_COLUMN]: '「保存しました」と表示される',
        },
        [],
      ),
    );

    expect(verdict.aiResult).toBe('PASS');
    // **見たのは文字の有無だけ**、と読める形で残す。過大に主張しない。
    expect(verdict.note).toContain('保存しました');
  });

  it('期待結果の文字が画面に無ければ FAIL', async () => {
    const { session } = await connect();

    const verdict = await runner('メモ一覧 0 件')(
      context(
        session,
        {
          [STEPS_COLUMN]: '保存をタップする',
          [EXPECTATION_COLUMN]: '「保存しました」と表示される',
        },
        [],
      ),
    );

    expect(verdict.aiResult).toBe('FAIL');
  });

  it('期待結果が機械で見られない場合は、操作までやって BLOCKED', async () => {
    const { adapter, session } = await connect();

    const verdict = await runner('なにか')(
      context(
        session,
        { [STEPS_COLUMN]: '保存をタップする', [EXPECTATION_COLUMN]: 'ホーム画面が表示される' },
        [],
      ),
    );

    // **操作はする。**人がライブで見て判断できる所まで進めるのが AI の仕事。
    expect(adapter.actions).toHaveLength(1);
    expect(verdict.aiResult).toBe('BLOCKED');
    expect(verdict.note).toContain('ホーム画面が表示される');
  });

  it('画面の文字が取れなければ BLOCKED（勝手に PASS にしない）', async () => {
    const { session } = await connect();

    const verdict = await runner(new Error('uiautomator が応答しない'))(
      context(
        session,
        {
          [STEPS_COLUMN]: '保存をタップする',
          [EXPECTATION_COLUMN]: '「保存しました」と表示される',
        },
        [],
      ),
    );

    expect(verdict.aiResult).toBe('BLOCKED');
    expect(verdict.note).toContain('uiautomator が応答しない');
  });

  it('手順の欄が空なら BLOCKED（空の操作で通さない）', async () => {
    const { session } = await connect();

    const verdict = await runner('なにか')(
      context(session, { [EXPECTATION_COLUMN]: '「あ」と表示される' }, []),
    );

    expect(verdict.aiResult).toBe('BLOCKED');
  });
});

describe('assertRunnableSheet — 繋ぐ前にシートを見る', () => {
  const header = (columns: string): string =>
    `#! md-business:test-spec-tsv/v1\n${columns}\n1\t起動\tアプリが起動する\t1. 保存をタップする\t「あ」と表示される\n`;

  it('手順と期待結果の列があれば通る', () => {
    const sheet = parseTestSpecTsv(
      header('No.:number!\t区分\t項目!\t手順:multiline!\t期待結果:multiline!'),
    );

    expect(() => assertRunnableSheet(sheet)).not.toThrow();
  });

  it('期待結果の列が無ければ、繋ぐ前に落とす', () => {
    const sheet = parseTestSpecTsv(
      header('No.:number!\t区分\t項目!\t手順:multiline!\tメモ:multiline'),
    );

    expect(() => assertRunnableSheet(sheet)).toThrow(/期待結果/);
  });
});

describe('createSheetCaseRunner — 起動', () => {
  it('シートが宣言したアプリを起動する', async () => {
    const { session } = await connect();
    const acted: unknown[] = [];
    const spy: TargetSession = {
      ...session,
      act: (action) => {
        acted.push(action);
        return Promise.resolve();
      },
      get isClosed() {
        return session.isClosed;
      },
    };
    // **1 回目は押す前の画面**（2026-09-24）。起動前にホーム画面は出ていない。
    let asked = 0;
    const run = createSheetCaseRunner({
      readScreenText: () => {
        asked += 1;
        return Promise.resolve(asked === 1 ? '' : 'ホーム画面');
      },
      app: 'com.android.settings',
      expectation: { waitMs: 0, stepMs: 1 },
    });

    const verdict = await run(
      context(
        spy,
        { [STEPS_COLUMN]: '1. アプリを起動する', [EXPECTATION_COLUMN]: '「ホーム画面」が出る' },
        [],
      ),
    );

    expect(acted).toEqual([{ kind: 'launch', app: 'com.android.settings' }]);
    expect(verdict.aiResult).toBe('PASS');
  });
});

/**
 * **動いているものに `FAIL` を付けない**（外部レビュー meta-taro/git-qa#12）。
 *
 * > 判定が出たあと同じ画面を読むと、**在ります。**
 * > この件では**クエリの実行に 518 ms** かかっていました。読んだのはその前でした。
 *
 * **クリックは「押した」時点で返る。**相手はそこから仕事を始める。
 *
 * > 空振りではなく、嘘が記録に残ります。……**動いているものが、壊れていると記録される。**
 *
 * 手順を落とせないときは `BLOCKED` で人へ渡る（控えめに倒す）のに、
 * **ここだけ `FAIL` を出していた。**しかもそれは、人が判定を置く前の既定値として画面に出る。
 */
describe('createSheetCaseRunner — 出るまで少し待つ', () => {
  const sheetRow = (steps: string, expectation: string): TsvRow => ({
    index: 0,
    line: 2,
    raw: '',
    rawCells: {},
    cells: { 'No.': '1', 項目: 'あ', 手順: steps, 期待結果: expectation },
  });

  const runOnce = async (
    texts: readonly string[],
    waitMs = 2000,
  ): Promise<{ verdict: CaseVerdict; reads: number }> => {
    let reads = 0;
    let asked = 0;
    const runner = createSheetCaseRunner({
      readScreenText: () => {
        // **1 回目は押す前の画面**（2026-09-24）。`reads` は押したあとの回数を数える。
        asked += 1;
        if (asked === 1) return Promise.resolve('');
        const said = texts[Math.min(reads, texts.length - 1)] ?? '';
        reads += 1;
        return Promise.resolve(said);
      },
      expectation: { waitMs, stepMs: 10 },
    });
    const session = await createFakeAdapter({}).connect();
    const verdict = await runner({
      subject: {
        no: 1,
        title: 'あ',
        row: sheetRow('1. 「実行」を押す', '「直前のクエリ」と表示される'),
      },
      session,
      step: () => undefined,
    });
    return { verdict, reads };
  };

  it('あとから出てきたら、通す', async () => {
    const { verdict } = await runOnce(['まだ', 'まだ', '直前のクエリ']);

    expect(verdict.aiResult).toBe('PASS');
  });

  /** **出たら即座に進む。**通る場合に余計な時間をかけない。 */
  it('出たら、それ以上読まない', async () => {
    const { reads } = await runOnce(['直前のクエリ']);

    expect(reads).toBe(1);
  });

  /**
   * **待ち切ったことを、判定文に書く。**
   *
   * > いまの「画面の文字に『直前のクエリ』が無い」は、**一度も見なかったのか、
   * > 待ったのに来なかったのか**を区別しません。
   */
  it('待っても出なければ、待ったことを書く', async () => {
    const { verdict } = await runOnce(['まだ'], 50);

    expect(verdict.aiResult).toBe('FAIL');
    // **どれだけ待って、何回見たか**を両方出す（片方だけでは人が判断できない）。
    expect(verdict.note).toContain('秒のあいだに');
    expect(verdict.note).toContain('回見ても');
    expect(verdict.note).toContain('直前のクエリ');
  });
});

/**
 * **1 回読むのに時間がかかる相手でも、もう一度見る**（2026-09-14・実物で測って気づいた）。
 *
 * デスクトップの画面読みは**実物で 7 秒**かかる。締切（既定 2 秒）だけで切ると、
 * **1 回目を読み終えた時点で既に過ぎている** —— #12 で入れた読み直しが、
 * **いちばん要る相手に効かない。**
 *
 * **落ちると言う前に、必ずもう一度見る。**
 */
describe('createSheetCaseRunner — 遅い相手でも、もう一度見る', () => {
  it('1 回目で締切を過ぎていても、2 回は読む', async () => {
    let reads = 0;
    const runner = createSheetCaseRunner({
      readScreenText: async () => {
        reads += 1;
        // 1 回読むのに、締切より長くかかる相手。
        await new Promise((r) => setTimeout(r, 30));
        return reads >= 2 ? '直前のクエリ' : 'クエリ未実行';
      },
      expectation: { waitMs: 10, stepMs: 1 },
    });
    const session = await createFakeAdapter({}).connect();
    const verdict = await runner({
      subject: {
        no: 1,
        title: 'あ',
        row: {
          index: 0,
          line: 2,
          raw: '',
          rawCells: {},
          cells: {
            'No.': '1',
            項目: 'あ',
            手順: '1. 「実行」を押す',
            期待結果: '「直前のクエリ」と表示される',
          },
        },
      },
      session,
      step: () => undefined,
    });

    expect(reads).toBe(2);
    expect(verdict.aiResult).toBe('PASS');
  });
});
