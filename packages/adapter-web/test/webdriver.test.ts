import { describe, expect, it, vi } from 'vitest';

import { createWebDriverClient, w3cPointer, w3cType } from '../src/webdriver.js';

/**
 * Safari とのやりとり（WebDriver・Issue 018）。
 *
 * **3 本目の約束。**Chrome は CDP、Firefox は BiDi、Safari は WebDriver。
 * WebDriver だけ **HTTP**（WebSocket ではない）。
 *
 * `safaridriver` は OS 付属。**依存はまた足さない。**
 */

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createWebDriverClient', () => {
  it('画面を開くと、その番号を持つ', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ value: { sessionId: 'S1' } }));
    const client = createWebDriverClient('http://127.0.0.1:9558', fetchImpl);

    await client.open();

    expect(client.sessionId).toBe('S1');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:9558/session');
  });

  /**
   * **断られた理由をそのまま渡す。**
   * 実測（2026-09-06）: `You must enable 'Allow remote automation' …` が返る。
   * この 1 文が人に届かないと、何をすればいいか分からない。
   */
  it('断られたら、Safari が書いた理由で落ちる', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          value: {
            error: 'session not created',
            message: "You must enable 'Allow remote automation' in the Developer section",
          },
        },
        500,
      ),
    );
    const client = createWebDriverClient('http://127.0.0.1:9558', fetchImpl);

    await expect(client.open()).rejects.toThrow(/Allow remote automation/);
  });

  it('開く前に命令を出したら、そう言って落ちる', async () => {
    const client = createWebDriverClient('http://127.0.0.1:9558', vi.fn());

    await expect(client.post('/url', { url: 'x' })).rejects.toThrow(/開く前/);
  });

  it('命令は画面の番号ごとの道へ送る', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ value: { sessionId: 'S1' } }))
      .mockResolvedValueOnce(jsonResponse({ value: null }));
    const client = createWebDriverClient('http://127.0.0.1:9558', fetchImpl);
    await client.open();

    await client.post('/url', { url: 'http://localhost:3000/' });

    expect(fetchImpl.mock.calls[1]?.[0]).toBe('http://127.0.0.1:9558/session/S1/url');
  });

  it('返ってきた値を取り出す', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ value: { sessionId: 'S1' } }))
      .mockResolvedValueOnce(jsonResponse({ value: 'Example Domain' }));
    const client = createWebDriverClient('http://127.0.0.1:9558', fetchImpl);
    await client.open();

    await expect(client.post('/execute/sync', {})).resolves.toBe('Example Domain');
  });
});

/** W3C の入力は「動きの並び」。**指の種類（pointerType）まで書く**のが BiDi との違い。 */
describe('w3cPointer', () => {
  it('動かして、押して、離す', () => {
    const group = w3cPointer({ x: 12, y: 34 })[0];

    expect(group?.parameters).toEqual({ pointerType: 'mouse' });
    expect(group?.actions.map((a) => a.type)).toEqual(['pointerMove', 'pointerDown', 'pointerUp']);
  });
});

describe('w3cType', () => {
  it('1 文字ずつ、押して離す', () => {
    expect(w3cType('ab')[0]?.actions.map((a) => a.type)).toEqual([
      'keyDown',
      'keyUp',
      'keyDown',
      'keyUp',
    ]);
  });

  it('日本語もそのまま送る', () => {
    expect(w3cType('あ')[0]?.actions[0]).toMatchObject({ value: 'あ' });
  });
});
