import { describe, expect, it, vi } from 'vitest';

import { watchAgentEvents } from '../../src/agent/client.js';
import type { EventSourceLike } from '../../src/agent/client.js';
import type { AgentCommand } from '../../src/agent/types.js';

/**
 * 入口サーバからの指示を受ける線（C120）。**届いた順に 1 つずつ。**
 */

class FakeEvents implements EventSourceLike {
  readonly listeners = new Map<string, (event: { data: string }) => void>();
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed = true;
  }
  emit(data: string): void {
    this.listeners.get('agent')?.({ data });
  }
}

describe('watchAgentEvents', () => {
  it('入口の URL の下の agent/events を開き、閉じると線を切る', () => {
    let opened: FakeEvents | undefined;
    const close = watchAgentEvents(
      'http://127.0.0.1:1/setup/x',
      () => Promise.resolve(),
      (url) => (opened = new FakeEvents(url)),
    );

    expect(opened?.url).toBe('http://127.0.0.1:1/setup/x/agent/events');
    close();
    expect(opened?.closed).toBe(true);
  });

  it('届いた指示を、前の動きが終わってから次へ、順に実行する', async () => {
    let events: FakeEvents | undefined;
    const done: string[] = [];
    let release: (() => void) | undefined;
    const run = (command: AgentCommand): Promise<void> => {
      if (command.action !== 'say') return Promise.resolve();
      if (command.message === '1') {
        return new Promise<void>((resolve) => {
          release = () => {
            done.push('1');
            resolve();
          };
        });
      }
      done.push(command.message);
      return Promise.resolve();
    };
    watchAgentEvents('http://h/setup/x', run, (url) => (events = new FakeEvents(url)));

    events?.emit(JSON.stringify({ action: 'say', message: '1' }));
    events?.emit(JSON.stringify({ action: 'say', message: '2' }));
    await Promise.resolve();
    expect(done).toEqual([]);

    release?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toEqual(['1', '2']);
  });

  it('壊れた知らせは捨て、失敗した操作は理由を言って次へ進む', async () => {
    let events: FakeEvents | undefined;
    const failures: string[] = [];
    const run = vi.fn((command: AgentCommand) =>
      command.action === 'say' && command.message === 'boom'
        ? Promise.reject(new Error('壊れた'))
        : Promise.resolve(),
    );
    watchAgentEvents(
      'http://h/setup/x',
      run,
      (url) => (events = new FakeEvents(url)),
      (reason) => failures.push(reason),
    );

    events?.emit('{not json');
    events?.emit(JSON.stringify({ action: 'dance' }));
    events?.emit(JSON.stringify({ action: 'say', message: 'boom' }));
    events?.emit(JSON.stringify({ action: 'say', message: 'next' }));
    await new Promise((r) => setTimeout(r, 0));

    expect(run).toHaveBeenCalledTimes(2);
    expect(failures).toEqual(['壊れた']);
  });
});
