import type { SessionState } from '@git-qa/core/session';
import type { LiveBridge, LiveBridgeOptions } from '@git-qa/live-bridge';

/** 橋の代わり。**publish された状態と、送り込む打鍵を握る。** */
export function fakeBridge(): {
  start: (options: LiveBridgeOptions) => Promise<LiveBridge>;
  states: SessionState[];
  send: (input: unknown) => void;
  viewer: (kind: 'joined' | 'left') => void;
  frames: () => AsyncIterable<Uint8Array>;
} {
  const states: SessionState[] = [];
  const handlers = new Set<(input: unknown) => void>();
  const watchers = new Set<(kind: 'joined' | 'left') => void>();
  let source: (() => AsyncIterable<Uint8Array>) | undefined;

  const bridge: LiveBridge = {
    url: 'http://127.0.0.1:65000/live/token.h264',
    controlUrl: 'http://127.0.0.1:65000/live/token/control',
    port: 65000,
    publish: (state) => states.push(state as SessionState),
    onInput: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onViewer: (handler) => {
      watchers.add(handler);
      return () => watchers.delete(handler);
    },
    close: () => Promise.resolve(),
  };

  return {
    start: (options) => {
      source = options.source;
      return Promise.resolve(bridge);
    },
    frames: () => source?.() ?? { async *[Symbol.asyncIterator]() {} },
    states,
    send: (input) => {
      for (const handler of handlers) handler(input);
    },
    viewer: (kind) => {
      for (const watcher of watchers) watcher(kind);
    },
  };
}
