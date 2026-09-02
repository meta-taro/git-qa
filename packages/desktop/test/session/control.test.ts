import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@git-qa/core/session';

import {
  connectControl,
  controlUrlFromLocation,
  sendHumanInput,
} from '../../src/session/control.js';

/**
 * 画面と実行器（Node）の線。**橋を通って来るものは信用しない**（形が違えば捨てる）。
 */

class FakeEventSource {
  readonly listeners: ((event: { data: string }) => void)[] = [];
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(_type: 'message', listener: (event: { data: string }) => void): void {
    this.listeners.push(listener);
  }
  close(): void {
    this.closed = true;
  }
  emit(data: string): void {
    for (const listener of this.listeners) listener({ data });
  }
}

const state: SessionState = {
  runId: 'r',
  phase: 'waiting',
  awaiting: 1,
  cases: [{ no: 1, title: 'アプリが起動する', aiResult: 'PASS' }],
};

describe('controlUrlFromLocation', () => {
  it('?control= から読む', () => {
    expect(controlUrlFromLocation('?control=http://127.0.0.1:5001/live/abc/control')).toBe(
      'http://127.0.0.1:5001/live/abc/control',
    );
  });

  it('localhost 以外・http 以外は受け取らない（映像と同じ規則）', () => {
    expect(controlUrlFromLocation('?control=http://example.com/live')).toBeUndefined();
    expect(controlUrlFromLocation('?control=https://127.0.0.1/live')).toBeUndefined();
    expect(controlUrlFromLocation('')).toBeUndefined();
  });
});

describe('connectControl', () => {
  it('届いた状態を渡す', () => {
    let source: FakeEventSource | undefined;
    const onState = vi.fn();
    connectControl({
      url: 'http://127.0.0.1:5001/live/abc/control',
      onState,
      createEventSource: (url) => (source = new FakeEventSource(url)),
    });

    expect(source?.url).toBe('http://127.0.0.1:5001/live/abc/control/events');
    source?.emit(JSON.stringify(state));
    expect(onState).toHaveBeenCalledWith(state);
  });

  it('形の違うものは捨てる（半分読めた一覧を人へ見せない）', () => {
    let source: FakeEventSource | undefined;
    const onState = vi.fn();
    connectControl({
      url: 'http://127.0.0.1:5001/live/abc/control',
      onState,
      createEventSource: (url) => (source = new FakeEventSource(url)),
    });

    source?.emit('{ こわれている');
    source?.emit(JSON.stringify({ runId: 'r', phase: 'ねている', cases: [] }));

    expect(onState).not.toHaveBeenCalled();
  });

  it('閉じると線も切れる', () => {
    let source: FakeEventSource | undefined;
    const client = connectControl({
      url: 'http://127.0.0.1:5001/live/abc/control',
      onState: vi.fn(),
      createEventSource: (url) => (source = new FakeEventSource(url)),
    });

    client.close();
    expect(source?.closed).toBe(true);
  });
});

describe('sendHumanInput', () => {
  it('打鍵を input へ送る', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    await sendHumanInput(
      'http://127.0.0.1:5001/live/abc/control',
      { kind: 'verdict', caseNo: 2, humanResult: 'VERIFIED' },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:5001/live/abc/control/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'verdict', caseNo: 2, humanResult: 'VERIFIED' }),
    });
  });

  it('受け取ってもらえなければ落とす（押したのに届いていない状態を黙らせない）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));

    await expect(
      sendHumanInput(
        'http://127.0.0.1:5001/live/abc/control',
        { kind: 'advance', caseNo: 1 },
        fetchImpl,
      ),
    ).rejects.toThrow(/400/);
  });
});
