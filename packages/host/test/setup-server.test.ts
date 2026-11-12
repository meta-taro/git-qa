import { afterEach, describe, expect, it, vi } from 'vitest';

import { startSetupServer } from '../src/index.js';
import type { SetupServer } from '../src/index.js';

/**
 * アプリを入口にするための口（Issue 011 段階 3）。
 *
 * **いまの入口はターミナル。**「検証シートの読み込み方も Android の接続の仕方も分からない」
 * という指摘に対して、**アプリを開いたら選んで始められる**ようにする。
 *
 * ここは**繋ぐ前から待っている**必要がある（端末を選ぶ前に画面が要るので）。
 */

let server: SetupServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const options = (overrides: Partial<Parameters<typeof startSetupServer>[0]> = {}) => ({
  listDevices: () => Promise.resolve([{ serial: 'emulator-5554', state: 'device' }]),
  findSheets: () => Promise.resolve(['/repo/docs/a.tsv']),
  start: () =>
    Promise.resolve({
      liveUrl: 'http://127.0.0.1:1/live/a.h264',
      controlUrl: 'http://127.0.0.1:1/live/a/control',
    }),
  ...overrides,
});

const json = async (url: string): Promise<Record<string, unknown>> =>
  (await (await fetch(url)).json()) as Record<string, unknown>;

/** いまの段を読む。 */
const phaseOf = async (server: { url: string }): Promise<string> =>
  ((await (await fetch(`${server.url}/state`)).json()) as { phase: string }).phase;

/** 条件が満たされるまで待つ。満たされなければ、何を待っていたかを言って落ちる。 */
const waitFor = async (predicate: () => Promise<boolean>): Promise<void> => {
  // **回数ではなく時計で待つ**（込み合った機械では setTimeout が伸びる）。
  for (const until = Date.now() + 10_000; Date.now() < until;) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('待っても起きなかった');
};

describe('startSetupServer', () => {
  it('127.0.0.1 でだけ待ち受け、URL に無作為の文字列を入れる', async () => {
    server = await startSetupServer(options());

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/setup\/[0-9a-f]{32}$/);
  });

  it('端末と検証シートの候補を返す', async () => {
    server = await startSetupServer(options());

    const state = await json(`${server.url}/state`);

    expect(state['phase']).toBe('idle');
    expect(state['devices']).toEqual([{ serial: 'emulator-5554', state: 'device' }]);
    expect(state['sheets']).toEqual(['/repo/docs/a.tsv']);
  });

  it('始めると、画面が読む URL を返す', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));

    const res = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/docs/a.tsv' }),
    });
    expect(res.status).toBe(202);

    for (const until = Date.now() + 10_000; Date.now() < until;) {
      const state = await json(`${server.url}/state`);
      if (state['phase'] === 'running') {
        expect(state['liveUrl']).toBe('http://127.0.0.1:9/live/x.h264');
        expect(start).toHaveBeenCalledWith({
          serial: 'emulator-5554',
          sheetPath: '/repo/docs/a.tsv',
        });
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('running にならなかった');
  });

  it('始められなかったら、理由を state に残す（黙って idle に戻さない）', async () => {
    server = await startSetupServer(
      options({ start: () => Promise.reject(new Error('端末が見つからない')) }),
    );

    await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'x', sheetPath: '/a.tsv' }),
    });

    for (const until = Date.now() + 10_000; Date.now() < until;) {
      const state = await json(`${server.url}/state`);
      if (state['phase'] === 'failed') {
        expect(state['error']).toContain('端末が見つからない');
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('failed にならなかった');
  });

  /**
   * **始められなかったら、選び直して始め直す場面**（2026-10-22・実物の画面で見た）。
   *
   * 失敗したときの state はシート・端末・止まった検証を空で返していたので、
   * 画面の一覧が最近使った分だけに減り、止まった検証は消えていた。
   */
  it('始められなかった後も、選ぶものは全部返す', async () => {
    server = await startSetupServer(
      options({
        start: () => Promise.reject(new Error('Firefox が起きない')),
        findResumable: () =>
          Promise.resolve([
            {
              runId: '20260911-090000',
              sheetPath: '/repo/docs/b.tsv',
              startedAt: '2026-09-11T09:00:00.000Z',
              cases: 4,
              placed: 3,
            },
          ]),
      }),
    );

    await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'x', sheetPath: '/a.tsv' }),
    });
    await waitFor(async () => (await phaseOf(server!)) === 'failed');

    const state = await json(`${server.url}/state`);
    expect(state['error']).toContain('Firefox が起きない');
    expect(state['sheets']).toEqual(['/repo/docs/a.tsv']);
    expect(state['devices']).toEqual([{ serial: 'emulator-5554', state: 'device' }]);
    expect(state['resumable']).toHaveLength(1);
  });

  it('二重に始めない（走っている最中の start は断る）', async () => {
    server = await startSetupServer(options());

    const send = () =>
      fetch(`${server!.url}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/docs/a.tsv' }),
      });

    expect((await send()).status).toBe(202);
    const second = await send();
    expect(second.status).toBe(409);
  });

  it('端末やシートの指定が無い start は受け取らない', async () => {
    server = await startSetupServer(options());

    const res = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554' }),
    });

    expect(res.status).toBe(400);
  });

  it('token が違えば 404', async () => {
    server = await startSetupServer(options());
    const wrong = `http://127.0.0.1:${String(server.port)}/setup/${'0'.repeat(32)}/state`;

    expect((await fetch(wrong)).status).toBe(404);
  });

  it('画面のオリジンからの読み取りを許す（別オリジンなので）', async () => {
    server = await startSetupServer(options());

    const res = await fetch(`${server.url}/state`, {
      headers: { origin: 'http://localhost:1420' },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:1420');
  });
});

describe('置いた人（ハンドル）', () => {
  /**
   * **`unknown` のまま証跡に残ると、「誰が保証したか」が読めない。**
   * この製品の芯なので、始めるときに受け取る。
   */
  it('ハンドルを受け取って実行へ渡す', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));

    await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serial: 'emulator-5554',
        sheetPath: '/repo/a.tsv',
        operator: 'octocat',
      }),
    });

    for (const until = Date.now() + 10_000; Date.now() < until;) {
      if (start.mock.calls.length > 0) {
        expect(start).toHaveBeenCalledWith({
          serial: 'emulator-5554',
          sheetPath: '/repo/a.tsv',
          operator: 'octocat',
        });
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('start が呼ばれなかった');
  });

  it('ハンドルが無くても始められる（環境変数で渡す道を残す）', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));

    const res = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/a.tsv' }),
    });

    expect(res.status).toBe(202);
  });

  it('個人名を書かせない形にする（長すぎるものは受け取らない）', async () => {
    server = await startSetupServer(options());

    const res = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serial: 'emulator-5554',
        sheetPath: '/repo/a.tsv',
        operator: 'a'.repeat(100),
      }),
    });

    expect(res.status).toBe(400);
  });
});

describe('シート探しの負荷', () => {
  /**
   * **状態は毎秒取りに来る。**そのたびにディスクを掘ると、探す場所が広いときに重い
   * （配布物では home の下を見る）。
   */
  it('毎回は探し直さない', async () => {
    const findSheets = vi.fn().mockResolvedValue(['/repo/a.tsv']);
    server = await startSetupServer(options({ findSheets }));

    await json(`${server.url}/state`);
    await json(`${server.url}/state`);
    await json(`${server.url}/state`);

    expect(findSheets).toHaveBeenCalledOnce();
  });
});

/**
 * **始める前にハンドルを確かめる。**
 *
 * 証跡の schema は ASCII に限っている（C18）。入口で弾かないと、5 件置き終わった
 * あとの保存で落ちる。実際にそれが起き、**人が実機で置いた 5 件が 2 回とも消えた**
 * （2026-09-04）。いちばん高くつく壊れ方なので、始める前に止める。
 */
describe('担当者ハンドル', () => {
  it('空白の入ったハンドルでは始めない', async () => {
    // **日本語は通る**（C53）。弾くのは空白・区切り・長すぎるものだけ。
    server = await startSetupServer(options({}));

    const response = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serial: 'emulator-5554',
        sheetPath: '/repo/a.tsv',
        operator: 'めた たろ',
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('ハンドル');
  });

  it('英数字のハンドルなら始まる', async () => {
    server = await startSetupServer(options({}));

    const response = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serial: 'emulator-5554',
        sheetPath: '/repo/a.tsv',
        operator: 'metataro',
      }),
    });

    expect(response.status).toBe(202);
  });

  /**
   * **鑑賞モード**（2026-09-11・人の指示）。
   *
   * 人は AI が進めるテストを眺めて見守る。
   *
   * 押さなくても進む形で始めたいかどうかは、**始める人が決める。**
   */
  it('鑑賞で始めたいという指定を、実行へ渡す', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));

    await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/a.tsv', watch: true }),
    });

    for (const until = Date.now() + 10_000; Date.now() < until;) {
      if (start.mock.calls.length > 0) {
        expect(start).toHaveBeenCalledWith({
          serial: 'emulator-5554',
          sheetPath: '/repo/a.tsv',
          watch: true,
        });
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('start が呼ばれなかった');
  });

  /** **指定が無ければ、今までどおり**（押すまで進まない）。 */
  it('指定が無ければ、鑑賞では始めない', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));

    await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/a.tsv' }),
    });

    for (const until = Date.now() + 10_000; Date.now() < until;) {
      if (start.mock.calls.length > 0) {
        expect(start.mock.calls[0]?.[0]).not.toHaveProperty('watch');
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('start が呼ばれなかった');
  });

  /**
   * **続きから**（2026-09-12・人の指示）。
   *
   * 途中で止まった実行を画面へ出し、選んだら**その実行に足す。**
   * 新しい実行にすると証跡が 2 本に割れ、読む人が突き合わせることになる。
   */
  it('途中で止まった実行を、画面へ渡す', async () => {
    server = await startSetupServer(
      options({
        findResumable: () =>
          Promise.resolve([
            {
              runId: '20260911-090000',
              sheetPath: '/w/検証.tsv',
              startedAt: '2026-09-11T09:00:00.000Z',
              cases: 4,
              placed: 3,
            },
          ]),
      }),
    );

    const state = (await (await fetch(`${server.url}/state`)).json()) as {
      resumable?: { runId: string; placed: number }[];
    };

    expect(state.resumable).toEqual([
      expect.objectContaining({ runId: '20260911-090000', placed: 3 }),
    ]);
  });

  it('続きからの指定を、実行へ渡す', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));

    await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serial: 'emulator-5554',
        sheetPath: '/repo/a.tsv',
        resume: '20260911-090000',
      }),
    });

    for (const until = Date.now() + 10_000; Date.now() < until;) {
      if (start.mock.calls.length > 0) {
        expect(start.mock.calls[0]?.[0]).toMatchObject({ resume: '20260911-090000' });
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('start が呼ばれなかった');
  });

  /** **形のおかしい指定は捨てる。**別の場所を読みに行かせない（`../` 等）。 */
  it('実行 ID の形をしていないものは受け取らない', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));

    await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serial: 'emulator-5554',
        sheetPath: '/repo/a.tsv',
        resume: '../../etc',
      }),
    });

    for (const until = Date.now() + 10_000; Date.now() < until;) {
      if (start.mock.calls.length > 0) {
        expect(start.mock.calls[0]?.[0]).not.toHaveProperty('resume');
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('start が呼ばれなかった');
  });

  /**
   * **端末が見えないことと、画面が出ないことは別**（2026-09-12・導入の直前に見つけた）。
   *
   * `adb` が入っていない機械では `listAndroidDevices` が `ENOENT` を投げる。
   * `/state` はその約束を `.catch` していなかったので、**応答が返らないまま固まる。**
   * 画面は「読み込み中」のまま、理由も出ない。
   *
   * **試験導入先の Windows は、まさに adb が入っていない機械。**
   * Android を見ないならウェブの URL だけで始められるのに、**入口で止まる。**
   */
  it('adb が無くても、画面は出る（端末は空・理由つき）', async () => {
    server = await startSetupServer(
      options({
        listDevices: () => Promise.reject(new Error('spawn adb ENOENT')),
      }),
    );

    const res = await fetch(`${server.url}/state`);
    const state = (await res.json()) as { devices: unknown[]; deviceError?: string };

    expect(res.status).toBe(200);
    expect(state.devices).toEqual([]);
    expect(state.deviceError).toContain('adb');
    // **人に見せる文は人の言葉で**（2026-11-10・Windows の実機で「spawn adb ENOENT」がそのまま出た）。
    expect(state.deviceError).toBe('adb が PATH に無い');
    expect(state.deviceError).not.toContain('ENOENT');
  });

  it('adb 以外の理由は、そのまま出す', async () => {
    server = await startSetupServer(
      options({
        listDevices: () => Promise.reject(new Error('device offline')),
      }),
    );
    const state = (await (await fetch(`${server.url}/state`)).json()) as { deviceError?: string };
    expect(state.deviceError).toBe('device offline');
  });

  /** シートを探せなくても同じ。**画面は出て、理由が出る。** */
  it('シートを探せなくても、画面は出る', async () => {
    server = await startSetupServer(
      options({ findSheets: () => Promise.reject(new Error('読めない')) }),
    );

    const res = await fetch(`${server.url}/state`);
    const state = (await res.json()) as { sheets: unknown[] };

    expect(res.status).toBe(200);
    expect(state.sheets).toEqual([]);
  });

  /** 途中で止まった実行を探せなくても、画面は出る。 */
  it('止まった実行を探せなくても、画面は出る', async () => {
    server = await startSetupServer(
      options({ findResumable: () => Promise.reject(new Error('読めない')) }),
    );

    expect((await fetch(`${server.url}/state`)).status).toBe(200);
  });

  /**
   * **1 本走らせたら、次が走らせられる**（外部レビュー meta-taro/git-qa#5）。
   *
   * > シートを 1 本走らせ終えると、その入口の画面は二度と使えません。
   *
   * `phase` は `idle → starting → running` と進んだきり、**戻る道も先へ進む道も無かった。**
   * `options.start` が解決するのは**実行が始まった**時点なので、
   * そのあと `phase` を書き換えるものが居ない。
   *
   * **「走っている最中」と「走り終えた」を、同じ値にしない。**
   */
  it('走り終えたら、次を受け取れる', async () => {
    // 立ち上げ直後に必ず入るので、ここでは在るものとして読む。
    let finish = (): void => undefined;
    const done = new Promise<void>((resolve) => (finish = resolve));
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
      done,
    });
    server = await startSetupServer(options({ start }));

    const begin = async (): Promise<number> =>
      (
        await fetch(`${server!.url}/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/a.tsv' }),
        })
      ).status;

    expect(await begin()).toBe(202);
    await waitFor(async () => (await phaseOf(server!)) === 'running');

    // **走っている最中は断る。**端末を二重に掴む。
    expect(await begin()).toBe(409);

    finish();
    await waitFor(async () => (await phaseOf(server!)) === 'done');

    expect(await begin()).toBe(202);
  });

  /** **断るなら、理由を出す。**本文が無いと、画面に出せるものが無い。 */
  it('断るときは理由を返す', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
      done: new Promise<void>(() => undefined),
    });
    server = await startSetupServer(options({ start }));

    const body = JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/a.tsv' });
    const send = (): Promise<Response> =>
      fetch(`${server!.url}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });

    await send();
    await waitFor(async () => (await phaseOf(server!)) === 'running');
    const refused = await send();

    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('走っている');
  });

  /** 完了の約束を持たない相手（古い呼び側）は、**今までどおり**。 */
  it('完了の約束が無ければ、running のまま', async () => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));

    await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/a.tsv' }),
    });
    await waitFor(async () => (await phaseOf(server!)) === 'running');

    expect(await phaseOf(server)).toBe('running');
  });
});

/**
 * **頼まれたケースだけを走らせる指定**（C112・外から起動する口のため）。
 *
 * 漏れを並べる側の道具が「このケースを確かめてくれ」と git-qa を呼ぶ。
 * **形のおかしいものは捨てて、理由を返す** —— 黙って全部走らせると、人は頼んだケースに
 * 着くまで他のケースに判定を置き続けることになる。
 */
describe('頼まれたケースだけ', () => {
  const started = async (body: Record<string, unknown>) => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));
    const res = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/a.tsv', ...body }),
    });
    return { start, res };
  };

  it('No. を受け取って実行へ渡す', async () => {
    const { start, res } = await started({ caseNo: 7 });
    expect(res.status).toBe(202);
    await waitFor(() => Promise.resolve(start.mock.calls.length > 0));
    expect(start.mock.calls[0]?.[0]).toMatchObject({ caseNo: 7 });
  });

  it('文字で来た No. も受け取る（URL から来るので）', async () => {
    const { start } = await started({ caseNo: '12' });
    await waitFor(() => Promise.resolve(start.mock.calls.length > 0));
    expect(start.mock.calls[0]?.[0]).toMatchObject({ caseNo: 12 });
  });

  it('指定が無ければ渡さない（全部走らせる）', async () => {
    const { start } = await started({});
    await waitFor(() => Promise.resolve(start.mock.calls.length > 0));
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty('caseNo');
  });

  it.each([0, -1, 1.5, 'abc', '', '../x'])(
    '1 以上の整数でない %j は断り、理由を返す',
    async (bad) => {
      const { start, res } = await started({ caseNo: bad });
      expect(res.status).toBe(400);
      expect(await res.text()).toMatch(/No\./);
      await new Promise((r) => setTimeout(r, 50));
      expect(start).not.toHaveBeenCalled();
    },
  );
});

/**
 * **録画する**（2026-11-07・人の指摘）。アプリの起動画面から頼まれた録画を実行へ渡す。
 * `watch` と同じく**真のときだけ持つ**。
 */
describe('録画を頼んで始める', () => {
  const started = async (body: Record<string, unknown>) => {
    const start = vi.fn().mockResolvedValue({
      liveUrl: 'http://127.0.0.1:9/live/x.h264',
      controlUrl: 'http://127.0.0.1:9/live/x/control',
    });
    server = await startSetupServer(options({ start }));
    const res = await fetch(`${server.url}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serial: 'emulator-5554', sheetPath: '/repo/a.tsv', ...body }),
    });
    return { start, res };
  };

  it('record: true を実行へ渡す', async () => {
    const { start, res } = await started({ record: true });
    expect(res.status).toBe(202);
    await waitFor(() => Promise.resolve(start.mock.calls.length > 0));
    expect(start.mock.calls[0]?.[0]).toMatchObject({ record: true });
  });

  it('指定が無い・真でないなら持たない', async () => {
    const { start } = await started({ record: 'yes' });
    await waitFor(() => Promise.resolve(start.mock.calls.length > 0));
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty('record');
  });
});

/**
 * **GitHub が答えないと、入口が開かず「はじめかた」のまま止まっていた**（2026-11-10・Windows の席）。
 * 新しい版の確認は入口を開くのを待たせない。答えが来たら、その後の状態に乗る。
 */
describe('startSetupServer — 新しい版の確認は入口を待たせない', () => {
  it('確認が返ってこなくても、入口は開いて state を返す', async () => {
    server = await startSetupServer(options({ checkRelease: () => new Promise(() => undefined) }));

    const state = await json(`${server.url}/state`);
    expect(state['phase']).toBe('idle');
    expect(state['upToDate']).toBeUndefined();
    expect(state['update']).toBeUndefined();
  });

  it('確認の答えが来たら、その後の state に乗る', async () => {
    let answer: ((value: { kind: 'latest' }) => void) | undefined;
    server = await startSetupServer(
      options({
        checkRelease: () =>
          new Promise<{ kind: 'latest' }>((resolve) => {
            answer = resolve;
          }),
      }),
    );

    expect((await json(`${server.url}/state`))['upToDate']).toBeUndefined();
    answer?.({ kind: 'latest' });
    await waitFor(async () => (await json(`${server!.url}/state`))['upToDate'] === true);
  });
});

/**
 * **端末やシートを数える所が返ってこないと、`/state` ごと返らず、画面は黙って留まる**（2026-11-10・Windows の席）。
 * 落ちるのは `orEmpty` で拾っていたが、**返ってこない**は拾えていなかった。期限を置いて、理由を返す。
 */
describe('startSetupServer — 数える所が返ってこなくても state は返る', () => {
  it('端末の一覧が返ってこなければ、期限で切って理由を添える', async () => {
    server = await startSetupServer(
      options({ listDevices: () => new Promise(() => undefined), listTimeoutMs: 50 }),
    );

    const state = await json(`${server.url}/state`);
    expect(state['phase']).toBe('idle');
    expect(state['devices']).toEqual([]);
    expect(String(state['deviceError'])).toContain('返らなかった');
  });

  it('シートの一覧が返ってこなくても、state は返る', async () => {
    server = await startSetupServer(
      options({ findSheets: () => new Promise(() => undefined), listTimeoutMs: 50 }),
    );

    const state = await json(`${server.url}/state`);
    expect(state['phase']).toBe('idle');
    expect(state['sheets']).toEqual([]);
  });
});

/**
 * **エージェントの専用カーソルへの口**（C120）。
 *
 * MCP の `screen` がここへ指示を置き、画面は SSE で受けて専用カーソルを動かす。
 * **置いたらすぐ返す。**画面の動きを待たない（ある席の遅い呼びが、ほかの席の呼びを止めない）。
 */
describe('startSetupServer — エージェントの専用カーソル（/agent）', () => {
  /** 画面のつもりで SSE を開き、最初に流れてきた `agent` の指示を読む口。 */
  const openScreen = async (
    url: string,
  ): Promise<{ next: () => Promise<string>; close: () => void }> => {
    const controller = new AbortController();
    const res = await fetch(`${url}/agent/events`, { signal: controller.signal });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    const next = async (): Promise<string> => {
      for (;;) {
        const at = buffered.indexOf('\n\n');
        if (at >= 0) {
          const frame = buffered.slice(0, at);
          buffered = buffered.slice(at + 2);
          if (frame.startsWith(':')) continue;
          return frame;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('画面への線が閉じた');
        buffered += decoder.decode(value, { stream: true });
      }
    };
    return { next, close: () => controller.abort() };
  };

  const post = (url: string, body: unknown): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('画面が繋いでいれば、検査した指示をそのまま流し、届けた画面の数を返す', async () => {
    server = await startSetupServer(options());
    const screen = await openScreen(server.url);
    try {
      const res = await post(server.agentUrl, { action: 'point', target: '始める', extra: 'x' });

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ screens: 1 });
      expect(await screen.next()).toBe(
        `event: agent\ndata: ${JSON.stringify({ action: 'point', target: '始める' })}`,
      );
    } finally {
      screen.close();
    }
  });

  it('画面が 1 つも繋いでいなければ、「画面を開いてから」と断る', async () => {
    server = await startSetupServer(options());

    const res = await post(server.agentUrl, { action: 'say', message: 'こんにちは' });

    expect(res.status).toBe(409);
    expect(await res.text()).toContain('画面を開いてから');
  });

  it('形のおかしい指示は、理由を言って断る（画面へは流さない）', async () => {
    server = await startSetupServer(options());
    const screen = await openScreen(server.url);
    try {
      const res = await post(server.agentUrl, { action: 'filter', value: 'qa' });

      expect(res.status).toBe(400);
      expect(await res.text()).toContain('人で絞る欄');
      // 流れていないことを、次の正しい指示が先頭で届くことで確かめる。
      await post(server.agentUrl, { action: 'say', message: 'ok' });
      expect(await screen.next()).toContain('"message":"ok"');
    } finally {
      screen.close();
    }
  });

  it('画面が読まなくても、置いた側はすぐ返る（遅い画面が、別の席の呼びを止めない）', async () => {
    server = await startSetupServer(options());
    const url = server.agentUrl;
    // 開くだけで、一度も読まない画面（画面の線は入口の下）。
    const controller = new AbortController();
    await fetch(`${server.url}/agent/events`, { signal: controller.signal });
    try {
      const began = Date.now();
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          post(url, { action: 'say', message: `一言 ${String(i)}`.repeat(20) }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([202, 202, 202, 202, 202]);
      expect(Date.now() - began).toBeLessThan(1_000);
    } finally {
      controller.abort();
    }
  });

  it('POST 以外は受けない', async () => {
    server = await startSetupServer(options());

    expect((await fetch(server.agentUrl)).status).toBe(405);
  });

  /**
   * **名乗りに出す口から、入口へ辿れない。**名乗りはホームの下のファイルで、同じ機械の別のプロセスが読める。
   * そこに入口の文字列を出すと、始める（/start・ハンドル付き）や判定の口（/state の controlUrl）へ辿れてしまう。
   */
  it('置く口は入口と別の文字列で、置く口から /state・/start へは辿れない', async () => {
    server = await startSetupServer(options());

    expect(server.agentUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/agent\/[0-9a-f]{32}$/);
    expect(server.agentUrl).not.toContain(server.url.slice(-32));
    expect((await fetch(`${server.agentUrl}/state`)).status).toBe(404);
    expect((await fetch(`${server.agentUrl}/start`, { method: 'POST' })).status).toBe(404);
    // 入口の文字列からも置けない（置く口は 1 つ）。
    expect((await post(`${server.url}/agent`, { action: 'say', message: 'a' })).status).toBe(404);
  });
});
