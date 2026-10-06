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
