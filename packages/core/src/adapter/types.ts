import type { CaseRecording, Target } from '../run/types.js';

/**
 * 対象アダプタ — git-qa が「見て・触れる」相手の抽象。
 *
 * 何が Adapter に入るかの線引きは C8。**ライブ映像を出せるものだけが入る。**
 * だから {@link TargetSession.liveView} は任意ではなく必須にしてある。
 * 省略できる形にすると、見るものが無い相手（API・CLI・バッチ）が入ってくる。
 * それらは「人が画面を見て保証する」という前提を持たないので、この道具の対象ではない。
 */
export interface TargetAdapter {
  /** run.json の `target.kind` と同じ語彙。別の名前を作らない。 */
  readonly kind: Target['kind'];
  readonly capabilities: AdapterCapabilities;
  connect(): Promise<TargetSession>;
}

export interface AdapterCapabilities {
  /**
   * 画面の状態をどの形で取れるか。**名前だけ持ち、中身は共通の型へ潰さない。**
   * Android のアクセシビリティツリーと Web の DOM は、そもそも同じものではない。
   */
  readonly observation: ObservationKind;
  /** 録画できるか。できないなら {@link CaseRecording} に `unsupported` を返す（C20）。 */
  readonly recording: boolean;
  /**
   * 文字をそのまま送れるか。**相手によって違うので、アダプタが名乗る。**
   *
   * Android の `input text` は IME を通らないので ASCII しか送れない（`'ascii-only'`）。
   * ブラウザはそのまま入る（`'any'`）。
   * **省略できる形にしない。**既定を置くと、送れないのに送ったことになる相手が混ざる。
   */
  readonly textInput: 'ascii-only' | 'any';
  /**
   * 行き先（`# 対象:`）の書き方。**相手によって違うので、アダプタが名乗る。**
   *
   * Android はパッケージ名、ウェブは URL（`'package-or-url'`）。
   * **デスクトップはアプリ名そのもの**（`'name'`）。
   *
   * 表示名を通さないという決めごと（C40）は Android の話で、
   * どのパッケージかが端末と地域で変わるのが理由。**その問題が無い相手にまで押し付けない。**
   */
  readonly appId: 'package-or-url' | 'name';
}

export type ObservationKind = 'accessibility-tree' | 'dom' | 'ui-automation' | 'none';

export interface TargetSession {
  /** そのまま run.json の `target` に入る。ここで作り直さない。 */
  readonly target: Target;
  readonly liveView: LiveView;
  readonly recording: RecordingControl;
  readonly isClosed: boolean;
  act(action: Action): Promise<void>;
  /**
   * 端末の画面の実寸。**映像を縮めて流している場合に、座標を戻すために要る。**
   * 取れない対象（Web など）は持たない。
   */
  screenSize?(): Promise<{ readonly width: number; readonly height: number }>;
  observe(): Promise<Observation>;
  screenshot(): Promise<Screenshot>;
  close(): Promise<void>;
}

/**
 * 人が見る窓。**主媒体はこちらで、動画は後から見返すための保管物**（C4）。
 */
export interface LiveView {
  readonly isOpen: boolean;
  readonly transport: LiveViewTransport;
  open(): Promise<void>;
  close(): Promise<void>;
  /**
   * 映像そのものを読む口。**枠の中に描く方式のときだけ持つ**
   * （`'h264-stream'` と `'image-frames'`）。
   *
   * 別窓で出す方式では映像はここを通らないので、無いのが正しい。
   * 「必ずある」ことにすると、別窓の実装が空の口を返すことになり、
   * **映像が来ないのか、そもそも通らない方式なのかが区別できなくなる。**
   */
  frames?(): AsyncIterable<Uint8Array>;
}

/** 映像の出し方。対応する対象を足すときにここへ増やす。 */
export type LiveViewTransport =
  /** 別の窓で出す。人が 2 つの窓を見比べることになるので、C4 とは噛み合わない。 */
  | { readonly kind: 'external-window'; readonly label: string }
  /**
   * 生 H.264（Annex-B）を流す。**アプリの枠の中に描ける**方式（C27 の方式 A）。
   * 受け手は `createAnnexBSplitter` で切って復号する。
   */
  | { readonly kind: 'h264-stream'; readonly label: string }
  /**
   * 画像を 1 枚ずつ流す（ウェブ検証・C54）。**こちらもアプリの枠の中に描ける**（C27 の方式 A）。
   *
   * ブラウザから来るのは `Page.screencastFrame` の画像で、H.264 のような区切りが無い。
   * 受け手は `createFrameSplitter` で切り、`createImageBitmap` で描く。
   */
  | { readonly kind: 'image-frames'; readonly label: string; readonly mimeType: 'image/jpeg' };

export interface Observation {
  readonly kind: Target['kind'];
  readonly capturedAt: string;
  /**
   * 対象ごとの生データ。**コアは解釈しない。**
   * 意味づけは、その形を知っている側（アダプタ、あるいは読む人）でやる。
   */
  readonly raw: unknown;
}

export interface Screenshot {
  /**
   * **撮った絵の、本当の形。**
   *
   * 2026-09-11 まで `'png'` しか無く、**デスクトップは JPEG を返しながら
   * png と名乗っていた。**MCP はそれを `image/png` として AI へ渡していた。
   * **名乗りと中身を合わせる**（合わないなら、合わない側を直す）。
   */
  readonly format: 'png' | 'jpg' | 'webp';
  readonly bytes: Uint8Array;
  readonly capturedAt: string;
}

/** 座標で指すか、対象側の識別子で指すか。識別子の中身はアダプタしか知らない。 */
export type PointerRef =
  | { readonly at: 'point'; readonly x: number; readonly y: number }
  | { readonly at: 'element'; readonly ref: string };

export type Action =
  | { readonly kind: 'tap'; readonly target: PointerRef }
  | {
      readonly kind: 'swipe';
      readonly from: PointerRef;
      readonly to: PointerRef;
      readonly durationMs?: number;
    }
  /**
   * 物を掴んで移す。**なぞる（swipe）とは別物。**
   *
   * なぞりはスクロール、ドラッグは並べ替えや投げ込み。
   * 同じ命令にまとめると、**どちらのつもりで書いたのかが読めなくなる。**
   */
  | { readonly kind: 'drag'; readonly from: PointerRef; readonly to: PointerRef }
  | { readonly kind: 'type'; readonly text: string; readonly target?: PointerRef }
  | { readonly kind: 'key'; readonly key: string }
  /**
   * アプリを起動する。**`app` は対象側の識別子そのまま**（Android ならパッケージ名）。
   * 表示名からの推測はしない。どのアプリかは、シートに書いてあるものだけを使う。
   */
  | { readonly kind: 'launch'; readonly app: string };

/**
 * 録画は実行開始時の設定であって、モードには紐づかない（C11）。
 * だから `requested` はセッションが持ち、止めたときの結果は 4 状態で返る（C20）。
 */
export interface RecordingControl {
  readonly requested: boolean;
  start(caseNo: number): Promise<void>;
  stop(): Promise<CaseRecording>;
}
