import { describe, expect, it } from 'vitest';

import type { TargetSession } from '../../src/adapter/types.js';
import { createFakeAdapter } from '../../src/adapter/fake.js';
import { createForegroundGuard, foregroundChangeReason } from '../../src/run/foreground-guard.js';

/**
 * **共有の実機を、別の人が使い始めていないかを見張る**（C121）。
 *
 * 2026-11-12、別の席が同じ iPhone を使っている最中に、git-qa がアプリを何度も前面へ出して
 * その作業を邪魔した。**操作の前に前面のアプリを読み、自分が最後に見たものと違えば止める。**
 */

/** 前面のアプリを、呼ばれた順に返すセッション。読めない回は `undefined`。 */
const withForeground = (session: TargetSession, fronts: (string | undefined)[]): TargetSession => {
  let i = 0;
  return {
    target: session.target,
    liveView: session.liveView,
    recording: session.recording,
    get isClosed() {
      return session.isClosed;
    },
    act: (action) => session.act(action),
    observe: () => session.observe(),
    screenshot: () => session.screenshot(),
    close: () => session.close(),
    foreground: () => Promise.resolve(fronts[i++]),
  };
};

const connect = async (fronts: (string | undefined)[]): Promise<TargetSession> =>
  withForeground(await createFakeAdapter({ kind: 'ios' }).connect(), fronts);

describe('foregroundChangeReason — 替わっていたら、その理由', () => {
  it('同じなら何も言わない', () => {
    expect(
      foregroundChangeReason('保存を押す', 'com.example.app', 'com.example.app'),
    ).toBeUndefined();
  });

  it('違えば、別の人が使っているかもしれないと言い、前と今を添える', () => {
    const reason = foregroundChangeReason(
      '保存を押す',
      'com.example.app',
      'com.apple.mobilesafari',
    );
    expect(reason).toContain('「保存を押す」の前に、前面のアプリが替わっていた');
    expect(reason).toContain('別の人が端末を使っているかもしれない');
    expect(reason).toContain('com.example.app → com.apple.mobilesafari');
  });

  /** **読めなかったことを「替わった」に混ぜない。**読めない相手では、この守りは効かないだけ。 */
  it('どちらかが読めなければ、替わったとは言わない', () => {
    expect(foregroundChangeReason('保存を押す', undefined, 'com.example.app')).toBeUndefined();
    expect(foregroundChangeReason('保存を押す', 'com.example.app', undefined)).toBeUndefined();
  });
});

describe('createForegroundGuard — 操作の前後で前面を見比べる', () => {
  it('初めて見たときは覚えるだけで、止めない', async () => {
    const guard = createForegroundGuard();
    const session = await connect(['com.example.app']);
    expect(await guard.check(session, '保存を押す')).toBeUndefined();
  });

  it('操作のあとに覚えたものと、次の操作の前が違えば止める', async () => {
    const guard = createForegroundGuard();
    const session = await connect(['com.example.app', 'com.example.app', 'com.apple.mobilesafari']);
    await guard.check(session, '保存を押す');
    await guard.remember(session);
    expect(await guard.check(session, '完了を押す')).toContain(
      'com.example.app → com.apple.mobilesafari',
    );
  });

  /** **自分の操作で替わった分は、操作のあとに覚えるので追い付く**（起動・別アプリへ飛ぶリンク）。 */
  it('自分の操作で替わった分は、止めない', async () => {
    const guard = createForegroundGuard();
    const session = await connect(['com.apple.springboard', 'com.example.app', 'com.example.app']);
    await guard.check(session, 'アプリを起動する');
    await guard.remember(session);
    expect(await guard.check(session, '保存を押す')).toBeUndefined();
  });

  /**
   * **止めたあとも、覚えているものは替えない。**
   * 相手が使い終えて前面が戻れば進める。戻らないうちは、次の件も触らない。
   */
  it('止めたあと、前面が戻らなければ次も止め、戻れば進める', async () => {
    const guard = createForegroundGuard();
    const session = await connect([
      'com.example.app',
      'com.example.app',
      'com.apple.mobilesafari',
      'com.apple.mobilesafari',
      'com.example.app',
    ]);
    await guard.check(session, '1');
    await guard.remember(session);
    expect(await guard.check(session, '2')).toBeDefined();
    expect(await guard.check(session, '3')).toBeDefined();
    expect(await guard.check(session, '4')).toBeUndefined();
  });

  it('前面を言えない相手では、何もしない', async () => {
    const guard = createForegroundGuard();
    const session = await createFakeAdapter({ kind: 'android' }).connect();
    expect(await guard.check(session, '保存を押す')).toBeUndefined();
    await guard.remember(session);
    expect(await guard.check(session, '完了を押す')).toBeUndefined();
  });

  it('読むのに失敗しても、操作は止めない（見張りの失敗を検証の失敗にしない）', async () => {
    const guard = createForegroundGuard();
    const base = await createFakeAdapter({ kind: 'ios' }).connect();
    const session: TargetSession = {
      ...withForeground(base, []),
      foreground: () => Promise.reject(new Error('口が返事をしない')),
    };
    expect(await guard.check(session, '保存を押す')).toBeUndefined();
  });
});
