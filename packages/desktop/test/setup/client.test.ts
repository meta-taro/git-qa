import { describe, expect, it, vi } from 'vitest';

import {
  fetchSetupState,
  requestStart,
  resolveSetupUrl,
  setupUrlFromLocation,
} from '../../src/setup/client.js';

/**
 * 入口サーバ（`@git-qa/host`）との線。**アプリを開いたら選んで始められる**ようにする側。
 */

describe('setupUrlFromLocation', () => {
  it('?setup= から読む', () => {
    expect(setupUrlFromLocation('?setup=http://127.0.0.1:5/setup/abc')).toBe(
      'http://127.0.0.1:5/setup/abc',
    );
  });

  it('localhost 以外・http 以外は受け取らない（映像や制御と同じ規則）', () => {
    expect(setupUrlFromLocation('?setup=https://example.com/setup')).toBeUndefined();
    expect(setupUrlFromLocation('')).toBeUndefined();
  });
});

describe('fetchSetupState', () => {
  it('端末とシートの候補を読む', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          phase: 'idle',
          devices: [{ serial: 'emulator-5554', state: 'device' }],
          sheets: ['/repo/a.tsv'],
        }),
        { status: 200 },
      ),
    );

    const state = await fetchSetupState('http://127.0.0.1:5/setup/abc', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:5/setup/abc/state');
    expect(state?.devices[0]?.serial).toBe('emulator-5554');
  });

  it('形が違えば受け取らない（黙って空の画面を出さない）', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"phase":"ねている"}', { status: 200 }));

    await expect(
      fetchSetupState('http://127.0.0.1:5/setup/abc', fetchImpl),
    ).resolves.toBeUndefined();
  });

  it('繋がらなければ undefined（落とさない）', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('繋がらない'));

    await expect(
      fetchSetupState('http://127.0.0.1:5/setup/abc', fetchImpl),
    ).resolves.toBeUndefined();
  });
});

describe('requestStart', () => {
  it('選んだ端末とシートを送る', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    await requestStart(
      'http://127.0.0.1:5/setup/abc',
      { serial: 'emulator-5554', sheetPath: '/repo/a.tsv' },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:5/setup/abc/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/a.tsv' }),
    });
  });

  it('断られたら落とす（押したのに始まっていない状態を黙らせない）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 409 }));

    await expect(
      requestStart('http://127.0.0.1:5/setup/abc', { serial: 'a', sheetPath: 'b' }, fetchImpl),
    ).rejects.toThrow(/409/);
  });

  /**
   * **断った側は理由を書いている。それを捨てていた。**
   *
   * 2026-09-06、人が「押しても開始されません」と言った。画面に出ていたのは
   * `実行を始められなかった: 400`。**400 は人に何も言っていない。**
   * 実行器は本文で理由を返していたのに、こちらが読まずに数字だけ出していた。
   */
  it('断られた理由が本文にあるなら、それを出す（数字だけにしない）', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('ハンドルに空白は使えない', { status: 400 }));

    await expect(
      requestStart('http://127.0.0.1:5/setup/abc', { serial: 'a', sheetPath: 'b' }, fetchImpl),
    ).rejects.toThrow(/ハンドルに空白は使えない/);
  });
});

describe('resolveSetupUrl — 配布物では URL をアプリに聞く', () => {
  /**
   * **配布物ではクエリで渡せない。**開発中（`pnpm app`）は `?setup=` が付くが、
   * `.app` を叩いたときは付かないので、Node 側を起こしたアプリに聞く。
   */
  it('クエリにあればそれを使う（アプリに聞きに行かない）', async () => {
    const ask = vi.fn();

    await expect(
      resolveSetupUrl('?setup=http://127.0.0.1:5/setup/abc', { ask, waitMs: 0, tries: 1 }),
    ).resolves.toBe('http://127.0.0.1:5/setup/abc');
    expect(ask).not.toHaveBeenCalled();
  });

  it('クエリに無ければアプリに聞く', async () => {
    const ask = vi.fn().mockResolvedValue('http://127.0.0.1:9/setup/xyz');

    await expect(resolveSetupUrl('', { ask, waitMs: 0, tries: 3 })).resolves.toBe(
      'http://127.0.0.1:9/setup/xyz',
    );
  });

  it('まだ起きていなければ、起きるまで聞き直す', async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue('http://127.0.0.1:9/setup/xyz');

    await expect(resolveSetupUrl('', { ask, waitMs: 0, tries: 5 })).resolves.toBe(
      'http://127.0.0.1:9/setup/xyz',
    );
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('起こせなかった理由は、そのまま投げる（黙って空の画面を出さない）', async () => {
    const ask = vi.fn().mockRejectedValue(new Error('Node を起こせない（node が要る）'));

    await expect(resolveSetupUrl('', { ask, waitMs: 0, tries: 3 })).rejects.toThrow(/node が要る/);
  });

  it('いつまでも起きなければ undefined（画面は案内を出す）', async () => {
    const ask = vi.fn().mockResolvedValue(null);

    await expect(resolveSetupUrl('', { ask, waitMs: 0, tries: 2 })).resolves.toBeUndefined();
  });
});

/**
 * **続きから**（2026-09-12・人の指示）。
 *
 * 途中で止まった実行を画面へ出す。**どこまで人が見て置いたか**を添える ——
 * 選ぶときに、いちばん知りたいのがそこ。
 */
describe('fetchSetupState — 途中で止まった実行', () => {
  const answer = (body: unknown): typeof fetch =>
    (() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) })) as unknown as typeof fetch;

  it('止まった実行を読む', async () => {
    const state = await fetchSetupState(
      'http://127.0.0.1:1/setup/x',
      answer({
        phase: 'idle',
        devices: [],
        sheets: [],
        resumable: [
          {
            runId: '20260911-090000',
            sheetPath: '/w/検証.tsv',
            startedAt: '2026-09-11T09:00:00.000Z',
            cases: 4,
            placed: 3,
          },
        ],
      }),
    );

    expect(state?.resumable).toEqual([
      {
        runId: '20260911-090000',
        sheetPath: '/w/検証.tsv',
        startedAt: '2026-09-11T09:00:00.000Z',
        cases: 4,
        placed: 3,
      },
    ]);
  });

  /** **形のおかしいものは捨てる。**当て推量で「4 件置いた」と出さない。 */
  it('形のおかしいものは落とす', async () => {
    const state = await fetchSetupState(
      'http://127.0.0.1:1/setup/x',
      answer({
        phase: 'idle',
        devices: [],
        sheets: [],
        resumable: [{ runId: '20260911-090000' }, 'これは実行ではない'],
      }),
    );

    expect(state?.resumable).toEqual([]);
  });

  /** 無ければ持たない（古い実行器と繋いだときも落ちない）。 */
  it('無ければ持たない', async () => {
    const state = await fetchSetupState(
      'http://127.0.0.1:1/setup/x',
      answer({ phase: 'idle', devices: [], sheets: [] }),
    );

    expect(state?.resumable).toBeUndefined();
  });
});

/**
 * **映像の種類を落とさない**（meta-taro/git-qa#18）。
 *
 * 実行器は「この相手は 1 枚ずつの絵（`images`）だ」と知らせているのに、
 * **読み取りがそこを写していなかった。**画面は既定の `h264` として復号器を作り、
 * **JPEG を H.264 として流し込んでいた。**
 *
 * **何も起きない。**復号器は待つだけなので、例外も出ず、記録にも何も出ない。
 * 人には「ライブビューが真っ白」としか見えない ——
 * **この道具の値打ち（人が見て判定する）が、黙って消える形。**
 *
 * CLI から始めたときは URL に種類が乗っているので出ていた。
 * **画面から始めた人だけが、映像の出ない道具を渡されていた。**
 */
describe('fetchSetupState — 映像の種類', () => {
  const stateWith = (extra: Record<string, unknown>): typeof fetch =>
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ phase: 'running', devices: [], sheets: [], ...extra }), {
        status: 200,
      }),
    );

  it('1 枚ずつの絵だと知らせてきたら、そう受け取る', async () => {
    const state = await fetchSetupState(
      'http://127.0.0.1:5/setup/abc',
      stateWith({ liveUrl: 'http://x/live', liveKind: 'images' }),
    );

    expect(state?.liveKind).toBe('images');
  });

  it('h264 も受け取る', async () => {
    const state = await fetchSetupState(
      'http://127.0.0.1:5/setup/abc',
      stateWith({ liveUrl: 'http://x/live', liveKind: 'h264' }),
    );

    expect(state?.liveKind).toBe('h264');
  });

  /** **知らない名前は受け取らない。**当て推量で復号器を選ぶと、また黙って白くなる。 */
  it('知らない種類は受け取らない', async () => {
    const state = await fetchSetupState(
      'http://127.0.0.1:5/setup/abc',
      stateWith({ liveUrl: 'http://x/live', liveKind: 'vp9' }),
    );

    expect(state?.liveKind).toBeUndefined();
  });
});
