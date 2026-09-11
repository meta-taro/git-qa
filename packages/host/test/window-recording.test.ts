import { describe, expect, it } from 'vitest';

import { createWindowRecording, findGitQaWindow } from '../src/window-recording.js';
import type { WindowRecordingDeps } from '../src/window-recording.js';

/**
 * **録るのは相手のアプリではなく、git-qa の窓**（2026-09-11・人の判断）。
 *
 * > 録画ですが、git-qa を最大化して、そのアプリを録画するとどうですか？
 *
 * そこには人が見たものが全部入っている —— ライブ映像、いまどのケースを判定して
 * いたか、AI が何と言ったか、矢印がどこを指していたか。
 * **相手のアプリだけ録っても、判定の根拠は写らない。**
 */

const deps = (overrides: Partial<WindowRecordingDeps> = {}): WindowRecordingDeps => ({
  recordPath: '/app/resources/git-qa-record',
  windowId: () => Promise.resolve(1234),
  dirFor: (no) => `/runs/20260911/case-${String(no).padStart(3, '0')}`,
  ensureDir: () => Promise.resolve(),
  spawn: () => ({ ready: Promise.resolve(), stop: () => Promise.resolve() }),
  toWebm: (_dir, name) => Promise.resolve({ name: name.replace('.mov', '.webm') }),
  now: () => new Date('2026-09-11T10:00:00.000Z'),
  ...overrides,
});

describe('createWindowRecording', () => {
  /** **道具が無いのは「失敗」ではない。**建てていない・macOS ではない、が普通にある。 */
  it('道具が無ければ、録らないと言う', async () => {
    const control = createWindowRecording(deps({ recordPath: undefined }));

    expect(control.requested).toBe(false);
    await control.start(1);

    expect(await control.stop()).toEqual({
      state: 'unsupported',
      reason: '窓を録る道具（git-qa-record）が無い',
    });
  });

  it('録れたら、置いたファイルと長さを返す', async () => {
    let ms = Date.parse('2026-09-11T10:00:00.000Z');
    const control = createWindowRecording(
      deps({
        now: () => {
          ms += 2000;
          return new Date(ms);
        },
      }),
    );

    await control.start(1);
    const done = await control.stop();

    expect(control.requested).toBe(true);
    expect(done).toEqual({
      state: 'recorded',
      file: 'case-001/screen.webm',
      durationMs: 2000,
    });
  });

  /** **窓が見つからないことは起きる**（最小化・別のデスクトップ）。黙らない。 */
  it('窓が見つからなければ、理由ごと失敗と言う', async () => {
    const control = createWindowRecording(deps({ windowId: () => Promise.resolve(undefined) }));

    await control.start(1);

    expect(await control.stop()).toEqual({
      state: 'failed',
      reason: 'git-qa の窓が見つからない（録画は始まらなかった）',
    });
  });

  /** 始まらなかったときも、**理由をそのまま残す。** */
  it('録画が始まらなければ、その理由を残す', async () => {
    const control = createWindowRecording(
      deps({
        spawn: () => ({
          ready: Promise.reject(new Error('画面収録の許可が無い')),
          stop: () => Promise.resolve(),
        }),
      }),
    );

    await control.start(1);
    const done = await control.stop();

    expect(done.state).toBe('failed');
    expect(done.state === 'failed' && done.reason).toContain('画面収録の許可が無い');
  });

  /** **始めていないのに止めない。**録画を頼まれていないケースがある。 */
  it('始めていなければ、録っていないと言う', async () => {
    expect(await createWindowRecording(deps()).stop()).toEqual({ state: 'not_requested' });
  });

  /** webm にできなくても、**動画は残っている。**名前は中身に合わせる。 */
  it('webm にできなければ、撮れた形の名前で返す', async () => {
    const control = createWindowRecording(
      deps({ toWebm: () => Promise.resolve({ name: 'screen.mov', note: 'ffmpeg が無い' }) }),
    );

    await control.start(2);
    const done = await control.stop();

    expect(done.state === 'recorded' && done.file).toBe('case-002/screen.mov');
  });

  /** **2 回続けて止めない。**2 度目は「録っていない」に戻る。 */
  it('止めた後にもう一度止めても、同じ動画を二重に数えない', async () => {
    const control = createWindowRecording(deps());

    await control.start(1);
    await control.stop();

    expect(await control.stop()).toEqual({ state: 'not_requested' });
  });
});

/**
 * **git-qa の窓は、名前が 2 通りある。**
 *
 * 配布物は `git-qa`、手元で `pnpm dev` すると `git-qa-desktop`（cargo が建てた名前）。
 * **試すのは開発中の人**なので、後者で見つからないと誰も録画を試せない。
 */
describe('findGitQaWindow', () => {
  it('配布物の名前で見つかれば、それを使う', async () => {
    const tried: string[] = [];
    const id = await findGitQaWindow((owner) => {
      tried.push(owner);
      return Promise.resolve(owner === 'git-qa' ? 77 : undefined);
    });

    expect(id).toBe(77);
    expect(tried).toEqual(['git-qa']);
  });

  it('手元で建てた名前でも見つける', async () => {
    expect(
      await findGitQaWindow((owner) =>
        Promise.resolve(owner === 'git-qa-desktop' ? 88 : undefined),
      ),
    ).toBe(88);
  });

  /** **見つからないことは起きる**（最小化・別のデスクトップ）。そのときは黙って undefined。 */
  it('どちらでも見つからなければ undefined', async () => {
    expect(await findGitQaWindow(() => Promise.resolve(undefined))).toBeUndefined();
  });

  /** 片方を見に行って落ちても、**もう片方を諦めない。** */
  it('途中で落ちても、次の名前を見る', async () => {
    const id = await findGitQaWindow((owner) =>
      owner === 'git-qa' ? Promise.reject(new Error('osascript が落ちた')) : Promise.resolve(99),
    );

    expect(id).toBe(99);
  });
});

/**
 * **長さは動画の長さ。**変換にかかった時間を足さない。
 *
 * 実測で気づいた（2026-09-11）: 5 秒録って `durationMs: 6880` が返っていた。
 * webm にする 1 秒ぶんを数えていた。**証跡の数字が、実物と食い違う。**
 */
describe('createWindowRecording — 長さ', () => {
  it('変換にかかった時間を、動画の長さに足さない', async () => {
    let ms = Date.parse('2026-09-11T10:00:00.000Z');
    const tick = (by: number): Date => {
      ms += by;
      return new Date(ms);
    };
    const control = createWindowRecording(
      deps({
        now: () => tick(0),
        toWebm: (_dir, name) => {
          // 変換に 3 秒かかったことにする。
          tick(3000);
          return Promise.resolve({ name: name.replace('.mov', '.webm') });
        },
      }),
    );

    await control.start(1);
    ms += 5000; // 5 秒録った
    const done = await control.stop();

    expect(done.state === 'recorded' && done.durationMs).toBe(5000);
  });
});
