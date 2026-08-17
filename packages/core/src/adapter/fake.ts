import { caseDirName } from '../run/layout.js';
import type { CaseRecording, Target } from '../run/types.js';
import { AdapterError } from './errors.js';
import type {
  Action,
  AdapterCapabilities,
  LiveView,
  Observation,
  RecordingControl,
  Screenshot,
  TargetAdapter,
  TargetSession,
} from './types.js';

/**
 * 何にも繋がないアダプタ。**テスト用**。
 *
 * 実機や adb が手元に無くても、この道具の芯（人が見て保証する流れ）を通しで動かせるようにする。
 * 本物のアダプタを足すときは、これと同じ約束（`test/adapter/contract.ts`）に通す。
 */
export interface FakeAdapter extends TargetAdapter {
  /** 受けた操作。順番のまま。 */
  readonly actions: readonly Action[];
}

export interface FakeAdapterOptions {
  readonly kind?: Target['kind'];
  /** 差し替えたいときだけ。既定は kind に応じた架空の対象。 */
  readonly target?: Target;
  /** observe() がそのまま返す生データ。 */
  readonly observation?: unknown;
  readonly screenshot?: Uint8Array;
  readonly recording?: {
    readonly requested?: boolean;
    /** 理由を入れると、録画が失敗した場合になる（not_requested と区別できることの確認用）。 */
    readonly failWith?: string;
  };
  readonly capabilities?: Partial<AdapterCapabilities>;
  /** 時刻の出どころ。既定は実時計。テストで固定したいとき用。 */
  readonly now?: () => Date;
}

/** PNG の署名だけの最小データ。中身は見ないが、空でないことに意味がある。 */
const PNG_STUB = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const defaultTarget = (kind: Target['kind']): Target => {
  const build = { source: 'example/sample-notes-app', label: 'fake' };
  switch (kind) {
    case 'android':
      return { kind, device: 'Fake Android Device', osVersion: '15', build };
    case 'web':
      return { kind, browser: 'Fake Browser', build };
    case 'desktop':
      return { kind, device: 'Fake Desktop', build };
  }
};

const defaultObservation = (kind: Target['kind']): unknown => ({
  note: `${kind} の生データはアダプタが決める。コアは解釈しない。`,
});

class FakeLiveView implements LiveView {
  #open = false;
  readonly transport = { kind: 'external-window', label: 'fake-live-view' } as const;

  get isOpen(): boolean {
    return this.#open;
  }

  open(): Promise<void> {
    this.#open = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.#open = false;
    return Promise.resolve();
  }
}

class FakeRecording implements RecordingControl {
  readonly requested: boolean;
  #supported: boolean;
  #failWith: string | undefined;
  #now: () => Date;
  #startedAt: number | undefined;
  #caseNo: number | undefined;

  constructor(options: {
    requested: boolean;
    supported: boolean;
    failWith: string | undefined;
    now: () => Date;
  }) {
    this.requested = options.requested;
    this.#supported = options.supported;
    this.#failWith = options.failWith;
    this.#now = options.now;
  }

  start(caseNo: number): Promise<void> {
    this.#caseNo = caseNo;
    this.#startedAt = this.#now().getTime();
    return Promise.resolve();
  }

  stop(): Promise<CaseRecording> {
    const startedAt = this.#startedAt;
    const caseNo = this.#caseNo;
    this.#startedAt = undefined;
    this.#caseNo = undefined;

    // 頼んでいない、あるいは始めていない。どちらも「録画オフ」であって失敗ではない。
    if (!this.requested || startedAt === undefined || caseNo === undefined) {
      return Promise.resolve({ state: 'not_requested' });
    }
    if (!this.#supported) {
      return Promise.resolve({
        state: 'unsupported',
        reason: 'このアダプタは録画に対応していない',
      });
    }
    if (this.#failWith !== undefined) {
      return Promise.resolve({ state: 'failed', reason: this.#failWith });
    }
    return Promise.resolve({
      state: 'recorded',
      file: `${caseDirName(caseNo)}/screen.mp4`,
      durationMs: Math.max(0, Math.round(this.#now().getTime() - startedAt)),
    });
  }
}

class FakeSession implements TargetSession {
  readonly target: Target;
  readonly liveView = new FakeLiveView();
  readonly recording: RecordingControl;
  #closed = false;
  #observation: unknown;
  #screenshot: Uint8Array;
  #now: () => Date;
  #actions: Action[];

  constructor(options: {
    target: Target;
    recording: RecordingControl;
    observation: unknown;
    screenshot: Uint8Array;
    now: () => Date;
    actions: Action[];
  }) {
    this.target = options.target;
    this.recording = options.recording;
    this.#observation = options.observation;
    this.#screenshot = options.screenshot;
    this.#now = options.now;
    this.#actions = options.actions;
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  /**
   * 閉じているなら投げるべきエラーを返す。**同期で throw しない。**
   * Promise を返す API が同期で投げると、呼び出し側の `.catch` を素通りする。
   */
  #closedError(what: string): AdapterError | undefined {
    if (!this.#closed) return undefined;
    return new AdapterError(this.target.kind, `閉じたセッションでは${what}できない`);
  }

  act(action: Action): Promise<void> {
    const closed = this.#closedError('操作');
    if (closed) return Promise.reject(closed);
    this.#actions.push(action);
    return Promise.resolve();
  }

  observe(): Promise<Observation> {
    const closed = this.#closedError('画面の状態を取得');
    if (closed) return Promise.reject(closed);
    return Promise.resolve({
      kind: this.target.kind,
      capturedAt: this.#now().toISOString(),
      raw: this.#observation,
    });
  }

  screenshot(): Promise<Screenshot> {
    const closed = this.#closedError('スクリーンショットを取得');
    if (closed) return Promise.reject(closed);
    return Promise.resolve({
      format: 'png',
      bytes: this.#screenshot,
      capturedAt: this.#now().toISOString(),
    });
  }

  async close(): Promise<void> {
    // 二重に閉じても落とさない。後始末は「失敗しても構わない」場所で呼ばれる。
    this.#closed = true;
    await this.liveView.close();
  }
}

export function createFakeAdapter(options: FakeAdapterOptions = {}): FakeAdapter {
  const kind = options.kind ?? 'android';
  const capabilities: AdapterCapabilities = {
    observation: options.capabilities?.observation ?? 'accessibility-tree',
    recording: options.capabilities?.recording ?? true,
  };
  const now = options.now ?? ((): Date => new Date());
  const actions: Action[] = [];

  return {
    kind,
    capabilities,
    actions,
    connect(): Promise<TargetSession> {
      return Promise.resolve(
        new FakeSession({
          target: options.target ?? defaultTarget(kind),
          recording: new FakeRecording({
            requested: options.recording?.requested ?? true,
            supported: capabilities.recording,
            failWith: options.recording?.failWith,
            now,
          }),
          observation: options.observation ?? defaultObservation(kind),
          screenshot: options.screenshot ?? PNG_STUB,
          now,
          actions,
        }),
      );
    },
  };
}
