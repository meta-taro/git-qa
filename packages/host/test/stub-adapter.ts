import { AdapterError } from '@git-qa/core';
import type {
  Action,
  LiveView,
  Observation,
  Screenshot,
  TargetAdapter,
  TargetSession,
} from '@git-qa/core';

export function nal(type: number, first = true): Uint8Array {
  return new Uint8Array([0, 0, 1, type & 0x1f, first ? 0x80 : 0x40, 0x11, 0x22]);
}

export interface StubTrace {
  readonly opened: string[];
  readonly closed: string[];
  /** 受けた操作。順番のまま。 */
  readonly actions: Action[];
  /** 映像を読み始めた回数。**繋ぎ直しに来たかどうか。** */
  frameStarts(): number;
}

/**
 * 映像を流すアダプタの代わり。**端末が要らない**（product-baseline §4）。
 *
 * `mode` で、映像を読む口を持つ / 持たないを切り替える。
 */
export function stubAdapter(options: {
  mode?: 'h264-stream' | 'external-window';
  chunks?: Uint8Array[];
  failOpen?: boolean;
  /** 映像を読み始めた時点で落ちる（画面が消えている等）。 */
  failFrames?: string;
  /**
   * `failFrames` で落ちる回数。**ケーブルを抜いて挿し直した**状況を作るために要る
   * （n 回落ちて、その後は流れる）。省略すると毎回落ちる。
   */
  failFramesTimes?: number;
  screen?: { width: number; height: number };
}): TargetAdapter & StubTrace {
  const opened: string[] = [];
  const closed: string[] = [];
  const actions: Action[] = [];
  /** 映像を読み始めた回数。**繋ぎ直しに来たかどうか**がこれで分かる。 */
  let frameStarts = 0;
  const mode = options.mode ?? 'h264-stream';
  const chunks = options.chunks ?? [nal(7), nal(8), nal(5), nal(1)];

  const liveView: LiveView = {
    isOpen: false,
    transport:
      mode === 'h264-stream'
        ? { kind: 'h264-stream', label: 'stub' }
        : { kind: 'external-window', label: 'stub' },
    open() {
      if (options.failOpen === true) {
        return Promise.reject(new AdapterError('android', 'ライブビューを開けない'));
      }
      opened.push('liveView');
      return Promise.resolve();
    },
    close() {
      closed.push('liveView');
      return Promise.resolve();
    },
    ...(mode === 'h264-stream'
      ? {
          frames(): AsyncIterable<Uint8Array> {
            return {
              // eslint-disable-next-line @typescript-eslint/require-await -- 同期の中身を非同期の口へ
              async *[Symbol.asyncIterator]() {
                frameStarts += 1;
                const times = options.failFramesTimes ?? Number.POSITIVE_INFINITY;
                if (options.failFrames !== undefined && frameStarts <= times) {
                  throw new Error(options.failFrames);
                }
                for (const c of chunks) yield c;
              },
            };
          },
        }
      : {}),
  };

  const session: TargetSession = {
    target: {
      kind: 'android',
      device: 'Stub',
      osVersion: '12',
      build: { source: 'example/sample-notes-app', label: 'stub' },
    },
    liveView,
    recording: {
      requested: false,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve({ state: 'not_requested' as const }),
    },
    isClosed: false,
    ...(options.screen === undefined
      ? {}
      : { screenSize: () => Promise.resolve(options.screen as { width: number; height: number }) }),
    act: (action: Action) => {
      actions.push(action);
      return Promise.resolve();
    },
    observe: (): Promise<Observation> =>
      Promise.resolve({ kind: 'android', capturedAt: '2026-09-02T00:00:00.000Z', raw: '' }),
    screenshot: (): Promise<Screenshot> =>
      Promise.resolve({
        format: 'png',
        bytes: new Uint8Array([1]),
        capturedAt: '2026-09-02T00:00:00.000Z',
      }),
    close() {
      closed.push('session');
      return Promise.resolve();
    },
  };

  return {
    kind: 'android',
    capabilities: { observation: 'accessibility-tree', recording: true },
    connect: () => {
      opened.push('session');
      return Promise.resolve(session);
    },
    opened,
    closed,
    actions,
    frameStarts: () => frameStarts,
  };
}
