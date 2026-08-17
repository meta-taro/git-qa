import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type CaseContext,
  type CaseVerdict,
  type ExecuteRunOptions,
  type HumanVerdict,
  type SheetRef,
  type TargetAdapter,
  type TargetSession,
  type TestSpecSheet,
  createFakeAdapter,
  executeRun,
  parseTestSpecTsv,
  validateRun,
} from '../../src/index.js';

const SHEET_TEXT = [
  '#! md-business:test-spec-tsv/v1',
  '# タイトル: サンプルメモ帳アプリ 検証シート',
  '# 文書番号: TEST-git-qa-001',
  'No.:number!\t区分\t項目!\t手順:multiline!\t期待結果:multiline!\t結果:enum(OK|NG|保留|未実施)!',
  '1\t起動\tアプリが起動する\t1. アプリアイコンをタップする\tホーム画面が表示される\t未実施',
  '2\tメモ作成\tメモを保存できる\t1. + をタップする\\n2. 保存をタップする\t一覧に表示される\t未実施',
].join('\r\n');

const sheet = (): TestSpecSheet => parseTestSpecTsv(SHEET_TEXT);

const sheetRef = (): SheetRef => ({
  path: 'docs/test-specs/001-sample-notes-app.tsv',
  sha256: createHash('sha256').update(SHEET_TEXT).digest('hex'),
  title: 'サンプルメモ帳アプリ 検証シート',
});

/** テストの間だけ進む時計。実時計だと「開始 < 終了」すら安定して見られない。 */
const tickingClock = (): (() => Date) => {
  let ms = Date.parse('2026-08-17T14:45:00.000Z');
  return () => {
    ms += 1000;
    return new Date(ms);
  };
};

const pass = (): Promise<CaseVerdict> => Promise.resolve({ aiResult: 'PASS' });

const options = (overrides: Partial<ExecuteRunOptions> = {}): ExecuteRunOptions => ({
  runId: '20260817-144500',
  sheet: sheet(),
  sheetRef: sheetRef(),
  adapter: createFakeAdapter({ recording: { requested: false } }),
  operator: { handle: 'octocat' },
  mode: 'auto',
  now: tickingClock(),
  runCase: pass,
  ...overrides,
});

describe('executeRun — 検証シートを走らせて run.json を 1 本出す', () => {
  it('シートの行がそのままケースになる', async () => {
    const run = await executeRun(options());
    expect(run.cases.map((c) => c.no)).toEqual([1, 2]);
    expect(run.cases.map((c) => c.title)).toEqual(['アプリが起動する', 'メモを保存できる']);
  });

  it('出てきた run.json はスキーマを通る', async () => {
    const run = await executeRun(options());
    const result = validateRun(run);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('読んだシートと実行者と runId が残る', async () => {
    const run = await executeRun(options());
    expect(run.runId).toBe('20260817-144500');
    expect(run.sheet.sha256).toBe(sheetRef().sha256);
    expect(run.operator.handle).toBe('octocat');
    expect(run.finishedAt).toBeDefined();
  });

  it('対象はアダプタが繋いだものがそのまま入る（コア側で組み直さない）', async () => {
    const adapter = createFakeAdapter({
      kind: 'android',
      target: { kind: 'android', device: 'Fake Pixel', build: { label: 'debug-42' } },
    });
    const run = await executeRun(options({ adapter }));
    expect(run.target).toEqual({
      kind: 'android',
      device: 'Fake Pixel',
      build: { label: 'debug-42' },
    });
  });

  it('ケースには手順の足跡（steps）が残る', async () => {
    const run = await executeRun(
      options({
        runCase: (ctx: CaseContext): Promise<CaseVerdict> => {
          ctx.step('アイコンをタップ');
          ctx.step();
          return Promise.resolve({ aiResult: 'PASS' });
        },
      }),
    );
    const steps = run.cases[0]?.steps ?? [];
    expect(steps.map((s) => s.index)).toEqual([0, 1]);
    expect(steps[0]?.label).toBe('アイコンをタップ');
    expect(steps[1]?.label).toBeUndefined();
  });
});

describe('executeRun — 人が見たかどうかが結果に出る（C1）', () => {
  it('人が置かなければ AUTO_PASS。人の名前は付かない', async () => {
    const run = await executeRun(options());
    expect(run.cases[0]?.result).toBe('AUTO_PASS');
    expect(run.cases[0]?.verifiedBy).toBeUndefined();
    expect(run.cases[0]?.humanResult).toBeUndefined();
  });

  it('人が置いた行は VERIFIED になり、名前と時刻が残る', async () => {
    const run = await executeRun(
      options({
        mode: 'assisted',
        askHuman: (): Promise<HumanVerdict> =>
          Promise.resolve({ humanResult: 'VERIFIED', by: 'octocat' }),
      }),
    );
    expect(run.cases[0]?.result).toBe('VERIFIED');
    expect(run.cases[0]?.verifiedBy).toBe('octocat');
    expect(run.cases[0]?.verifiedAt).toBeDefined();
  });

  it('VERIFIED と AUTO_PASS が同じ run.json に並ぶ', async () => {
    // ここが潰れると製品の意味が無くなる。「全部通った」ではなく「誰が見たか」が読める。
    const run = await executeRun(
      options({
        mode: 'assisted',
        askHuman: (ctx: CaseContext): Promise<HumanVerdict | undefined> =>
          Promise.resolve(
            ctx.subject.no === 1 ? { humanResult: 'VERIFIED', by: 'octocat' } : undefined,
          ),
      }),
    );
    expect(run.cases.map((c) => c.result)).toEqual(['VERIFIED', 'AUTO_PASS']);
    expect(validateRun(run).valid).toBe(true);
  });

  it('AI が通していても、人が落とせば落ちる', async () => {
    const run = await executeRun(
      options({
        mode: 'assisted',
        askHuman: (): Promise<HumanVerdict> =>
          Promise.resolve({ humanResult: 'FAIL', by: 'octocat', note: '一覧が更新されない' }),
      }),
    );
    expect(run.cases[0]?.aiResult).toBe('PASS');
    expect(run.cases[0]?.result).toBe('FAIL');
    expect(run.cases[0]?.note).toContain('一覧が更新されない');
  });
});

describe('executeRun — 録画したかどうかが実行ごとに出る（C11 / C20）', () => {
  it('録画ありで走らせると recorded が残る', async () => {
    const run = await executeRun(
      options({ adapter: createFakeAdapter({ recording: { requested: true } }) }),
    );
    expect(run.recording.requested).toBe(true);
    const recording = run.cases[0]?.recording;
    expect(recording?.state).toBe('recorded');
    expect(recording).toMatchObject({ file: 'case-001/screen.mp4' });
    expect(typeof (recording as { durationMs?: unknown }).durationMs).toBe('number');
  });

  it('録画なしで走らせると not_requested が残る（失敗と区別がつく）', async () => {
    const run = await executeRun(
      options({ adapter: createFakeAdapter({ recording: { requested: false } }) }),
    );
    expect(run.recording.requested).toBe(false);
    expect(run.cases[0]?.recording).toEqual({ state: 'not_requested' });
  });

  it('録画に失敗した実行は、録画なしとは別の値で残る', async () => {
    const run = await executeRun(
      options({
        adapter: createFakeAdapter({
          recording: { requested: true, failWith: 'scrcpy が途中で落ちた' },
        }),
      }),
    );
    expect(run.cases[0]?.recording).toEqual({
      state: 'failed',
      reason: 'scrcpy が途中で落ちた',
    });
  });
});

describe('executeRun — 実行中は人が見られる状態にする（C4）', () => {
  it('ケースを走らせている間、ライブビューが開いている', async () => {
    let openDuringCase: boolean | undefined;
    await executeRun(
      options({
        runCase: (ctx: CaseContext): Promise<CaseVerdict> => {
          openDuringCase = ctx.session.liveView.isOpen;
          return pass();
        },
      }),
    );
    expect(openDuringCase).toBe(true);
  });

  it('終わったらセッションを閉じる', async () => {
    let session: CaseContext['session'] | undefined;
    await executeRun(
      options({
        runCase: (ctx: CaseContext): Promise<CaseVerdict> => {
          session = ctx.session;
          return pass();
        },
      }),
    );
    expect(session?.isClosed).toBe(true);
    expect(session?.liveView.isOpen).toBe(false);
  });
});

describe('executeRun — 落ちても記録を残す', () => {
  it('ケースが例外を投げても、そのケースを FAIL にして後続を続ける', async () => {
    const run = await executeRun(
      options({
        runCase: (ctx: CaseContext): Promise<CaseVerdict> => {
          if (ctx.subject.no === 1) throw new Error('要素が見つからない');
          return pass();
        },
      }),
    );
    expect(run.cases[0]?.result).toBe('FAIL');
    expect(run.cases[0]?.note).toContain('要素が見つからない');
    expect(run.cases[1]?.result).toBe('AUTO_PASS');
    expect(validateRun(run).valid).toBe(true);
  });

  it('録画の停止が失敗しても、合否は残し、理由を書く', async () => {
    // 動画が取れなかったことでケースの合否まで消えると、実行そのものがやり直しになる。
    const base = createFakeAdapter({ recording: { requested: true } });
    const adapter: TargetAdapter = {
      kind: base.kind,
      capabilities: base.capabilities,
      connect: async (): Promise<TargetSession> => {
        const session = await base.connect();
        return {
          ...session,
          act: (a) => session.act(a),
          observe: () => session.observe(),
          screenshot: () => session.screenshot(),
          close: () => session.close(),
          recording: {
            requested: true,
            start: (no: number) => session.recording.start(no),
            stop: () => Promise.reject(new Error('録画プロセスが応答しない')),
          },
        };
      },
    };

    const run = await executeRun(options({ adapter }));
    expect(run.cases[0]?.result).toBe('AUTO_PASS');
    expect(run.cases[0]?.recording).toEqual({
      state: 'failed',
      reason: '録画プロセスが応答しない',
    });
  });

  it('途中で投げ出しても、セッションは閉じる', async () => {
    let session: CaseContext['session'] | undefined;
    await expect(
      executeRun(
        options({
          runCase: (ctx: CaseContext): Promise<CaseVerdict> => {
            session = ctx.session;
            return pass();
          },
          askHuman: (): Promise<HumanVerdict> => {
            // 人へ聞く経路が壊れた。ここで握り潰すと「誰も見ていない」が消える。
            throw new Error('入力を受け取れない');
          },
          mode: 'assisted',
        }),
      ),
    ).rejects.toThrow(/入力を受け取れない/);
    expect(session?.isClosed).toBe(true);
  });
});

describe('executeRun — 走らせる前に弾く', () => {
  it('No. が重複したシートは走らせない', async () => {
    const broken = parseTestSpecTsv(SHEET_TEXT.replace('\r\n2\tメモ作成', '\r\n1\tメモ作成'));
    await expect(executeRun(options({ sheet: broken }))).rejects.toThrow(/No\./);
  });

  it('No. が数値でない行があれば走らせない', async () => {
    const broken = parseTestSpecTsv(SHEET_TEXT.replace('\r\n2\tメモ作成', '\r\n-\tメモ作成'));
    await expect(executeRun(options({ sheet: broken }))).rejects.toThrow(/No\./);
  });

  it('項目が空の行があれば走らせない', async () => {
    // 名前の無いケースは、証跡になっても何を確かめたのか読めない。
    const broken = parseTestSpecTsv(SHEET_TEXT.replace('\tメモを保存できる\t', '\t\t'));
    await expect(executeRun(options({ sheet: broken }))).rejects.toThrow(/項目/);
  });

  it('項目の無いシートは走らせない', async () => {
    const broken = parseTestSpecTsv(SHEET_TEXT.replace('\t項目!', '\tタイトル'));
    await expect(executeRun(options({ sheet: broken }))).rejects.toThrow(/項目/);
  });

  it('人が見る実行なのに聞く先が無ければ走らせない', async () => {
    // assisted は「AI が操作し人が見る」。聞かずに走ると、全部 AUTO_PASS の実行が出来上がる。
    await expect(executeRun(options({ mode: 'assisted' }))).rejects.toThrow(/askHuman/);
  });

  it('AI だけの実行なのに聞く先があれば走らせない', async () => {
    await expect(
      executeRun(
        options({
          mode: 'auto',
          askHuman: (): Promise<undefined> => Promise.resolve(undefined),
        }),
      ),
    ).rejects.toThrow(/auto/);
  });
});
