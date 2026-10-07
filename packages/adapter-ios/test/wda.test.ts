import { describe, expect, it } from 'vitest';

import { createWdaClient, pickByText, toPoints } from '../src/wda.js';

/**
 * **iPhone / iPad を押す口**（WebDriverAgent・2026-10-06 に作ると決めた・C99）。
 *
 * WebDriverAgent（WDA）は端末の中で動く HTTP の口。**押す・打つ**をここへ頼む。
 * 署名して端末へ入れるのは人の作業（Apple の開発者アカウント）。git-qa はその口を使うだけ。
 *
 * 試験では WDA を偽の `fetch` で置き換え、**何を頼んだか**を見る。
 */
type Sent = { method: string; path: string; body?: unknown };

const fakeWda = (scale = 3) => {
  const sent: Sent[] = [];
  const fetchImpl = (url: string, init?: { method?: string; body?: string }) => {
    const path = new URL(url).pathname;
    const method = init?.method ?? 'GET';
    sent.push({
      method,
      path,
      ...(init?.body === undefined ? {} : { body: JSON.parse(init.body) }),
    });
    const reply = (value: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });
    if (path === '/status') return reply({ value: { ready: true } });
    if (path === '/session' && method === 'POST')
      return reply({ sessionId: 'S1', value: { sessionId: 'S1' } });
    if (path.endsWith('/wda/screen')) return reply({ value: { scale } });
    return reply({ value: null });
  };
  return { sent, fetchImpl };
};

describe('toPoints', () => {
  /** 映像は画素、WDA はポイントを受け取る。**倍率で割る**（iPhone はふつう 3 倍）。 */
  it('画素をポイントに直す', () => {
    expect(toPoints({ x: 603, y: 1311 }, 3)).toEqual({ x: 201, y: 437 });
  });
});

describe('pickByText', () => {
  const ocr = [
    '設定\t600\t300\t90\t40',
    'Wi-Fi の設定\t600\t900\t300\t40',
    '設定\t200\t2000\t60\t30',
  ].join('\n');

  it('完全一致を先に、その中でいちばん小さいもの', () => {
    expect(pickByText(ocr, '設定')).toEqual({ x: 200, y: 2000, width: 60, height: 30 });
  });

  it('完全一致が無ければ部分一致', () => {
    expect(pickByText(ocr, 'Wi-Fi')).toEqual({ x: 600, y: 900, width: 300, height: 40 });
  });

  it('無ければ undefined（当てずっぽうで押さない）', () => {
    expect(pickByText(ocr, '一般')).toBeUndefined();
  });
});

describe('createWdaClient', () => {
  it('口が生きているかを聞く', async () => {
    const { fetchImpl } = fakeWda();
    const wda = createWdaClient('http://127.0.0.1:8100', fetchImpl);

    await expect(wda.ready()).resolves.toBe(true);
  });

  it('押すのは、ポイントの座標で「指を置いて離す」', async () => {
    const { sent, fetchImpl } = fakeWda();
    const wda = createWdaClient('http://127.0.0.1:8100', fetchImpl);

    await wda.tap({ x: 201, y: 437 });

    const actions = sent.find((one) => one.path === '/session/S1/actions');
    expect(actions?.method).toBe('POST');
    expect(JSON.stringify(actions?.body)).toContain('"pointerType":"touch"');
    expect(JSON.stringify(actions?.body)).toContain('"x":201');
    expect(JSON.stringify(actions?.body)).toContain('"y":437');
  });

  it('倍率を聞く', async () => {
    const { fetchImpl } = fakeWda(2);
    const wda = createWdaClient('http://127.0.0.1:8100', fetchImpl);

    await expect(wda.scale()).resolves.toBe(2);
  });

  it('文字は、いま焦点のある欄へ打つ', async () => {
    const { sent, fetchImpl } = fakeWda();
    const wda = createWdaClient('http://127.0.0.1:8100', fetchImpl);

    await wda.type('テスト太郎');

    const keys = sent.find((one) => one.path === '/session/S1/wda/keys');
    expect(keys?.body).toEqual({ value: ['テ', 'ス', 'ト', '太', '郎'] });
  });

  /** **口が生きていなければ、そう言う。**押せたことにしない。 */
  it('口が返事をしなければ、理由を言って落ちる', async () => {
    const wda = createWdaClient('http://127.0.0.1:8100', () =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    );

    await expect(wda.tap({ x: 1, y: 1 })).rejects.toThrow(/WebDriverAgent.*ECONNREFUSED/);
  });
});

/**
 * **セッションが無効になったら、作り直して 1 回だけやり直す**（2026-10-07・実機で踏んだ）。
 * WDA はセッションを 1 つしか持てない。別の誰かが作ると前のものは消え、押すと 404 になった。
 */
describe('createWdaClient — セッションの作り直し', () => {
  it('404 が返ったら、セッションを作り直してやり直す', async () => {
    const sent: string[] = [];
    let sessions = 0;
    const fetchImpl = (url: string, init?: { method?: string; body?: string }) => {
      const path = new URL(url).pathname;
      sent.push(`${init?.method ?? 'GET'} ${path}`);
      const reply = (status: number, value: unknown) =>
        Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(value) });
      if (path === '/session') {
        sessions += 1;
        return reply(200, { sessionId: `S${String(sessions)}` });
      }
      // 1 本目のセッションは、もう消えている。
      if (path.startsWith('/session/S1/'))
        return reply(404, { value: { error: 'invalid session id' } });
      return reply(200, { value: null });
    };
    const wda = createWdaClient('http://127.0.0.1:8100', fetchImpl);

    await wda.tap({ x: 1, y: 2 });

    expect(sessions).toBe(2);
    expect(sent.filter((one) => one.endsWith('/actions'))).toEqual([
      'POST /session/S1/actions',
      'POST /session/S2/actions',
    ]);
  });
});

/** **なぞる**（2026-10-07）。指を置いて、間を取りながら動かして離す。 */
describe('createWdaClient — なぞる', () => {
  it('指を置いて動かして離す（ポイントの座標で）', async () => {
    const { sent, fetchImpl } = fakeWda();
    const wda = createWdaClient('http://127.0.0.1:8100', fetchImpl);

    await wda.swipe({ x: 180, y: 600 }, { x: 180, y: 250 }, 300);

    const body = JSON.stringify(sent.find((one) => one.path === '/session/S1/actions')?.body);
    expect(body).toContain('"x":180,"y":600');
    expect(body).toContain('"duration":300,"x":180,"y":250');
  });
});

/**
 * **画面の絵を WDA から取る**（2026-10-07・実機で踏んだ）。
 * USB で映す口は、前のプロセスが手放した直後に 10 秒以上見えなくなり、手順ごとに撮ると必ず落ちた。
 * WDA があるなら、絵も WDA から取る（PNG を base64 で返す）。
 */
describe('createWdaClient — 画面の絵', () => {
  it('base64 の PNG を、そのままの bytes に戻す', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const fetchImpl = (url: string) => {
      const path = new URL(url).pathname;
      const value = path === '/screenshot' ? png.toString('base64') : null;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ value }) });
    };
    const wda = createWdaClient('http://127.0.0.1:8100', fetchImpl);

    const got = await wda.screenshot();

    expect([...got]).toEqual([...png]);
  });
});

describe('createWdaClient — 起動とホーム', () => {
  it('識別子でアプリを起動する', async () => {
    const { sent, fetchImpl } = fakeWda();
    const wda = createWdaClient('http://127.0.0.1:8100', fetchImpl);

    await wda.launch('com.apple.Preferences');

    expect(sent.find((one) => one.path === '/session/S1/wda/apps/launch')?.body).toEqual({
      bundleId: 'com.apple.Preferences',
    });
  });

  it('ホーム画面へ戻る', async () => {
    const { sent, fetchImpl } = fakeWda();
    const wda = createWdaClient('http://127.0.0.1:8100', fetchImpl);

    await wda.home();

    expect(sent.some((one) => one.path === '/wda/homescreen' && one.method === 'POST')).toBe(true);
  });
});
