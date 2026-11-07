import { t } from '../i18n/current.js';

/**
 * メニューから検証シートを開く（Issue 011）。
 *
 * **開くファイルの場所は画面が持っている**（実行状態と一緒に届く `sheetPath`）。
 * メニュー側（Rust）は「押された」ことだけを伝えてくる。
 * そうしないと、Rust が別のファイルを推測して開きうる。
 */

export type OpenMode = 'md-business' | 'reveal' | 'default';

const MODES: Readonly<Record<string, OpenMode>> = {
  'file:md-business': 'md-business',
  'file:reveal': 'reveal',
  'file:open': 'default',
};

export interface OpenSheetBridge {
  open(path: string, mode: OpenMode): Promise<void>;
  /** メニューが押されたことを受け取る。戻り値を呼ぶと解除。 */
  subscribe(handler: (action: string) => void): Promise<() => void>;
}

/** 本物の Tauri へ繋ぐ。**ブラウザで開いているときは `undefined`。** */
export function tauriOpenSheetBridge(): OpenSheetBridge | undefined {
  if (!('__TAURI_INTERNALS__' in window)) return undefined;
  return {
    async open(path, mode) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_sheet', { path, mode });
    },
    async subscribe(handler) {
      const { listen } = await import('@tauri-apps/api/event');
      return listen<string>('menu-action', (event) => handler(event.payload));
    },
  };
}

export interface MenuActionOptions {
  readonly bridge?: OpenSheetBridge | undefined;
  /** いま走らせている検証シートの場所。 */
  readonly sheetPath: () => string | undefined;
  /** 開けなかった理由を人へ出す。**console だけでは見えない。** */
  readonly onError: (message: string) => void;
}

export interface EvidenceOpenerOptions {
  /** 本物の Tauri。**ブラウザで開いているときは `undefined`**（押しても黙らず、そう言う）。 */
  readonly bridge?: OpenSheetBridge | undefined;
  readonly onError: (message: string) => void;
}

/**
 * **証跡を開く**（2026-11-07・人の指摘）。
 *
 * 判定の画面に「証跡を書いた: …」と場所は出ていたのに、判定時の画面（`screen.webp`）も
 * 動画（`screen.webm`）もアプリの中からは辿れなかった。**書いた場所（`run.json`）を
 * ファイル管理ソフトで選んだ状態にする**。1 件ごとの絵と動画は、その隣の `case-NNN/` に在る。
 *
 * **開く場所は押す所（`data-path`）が持っている**（実行が実際に書いた場所。ここで組み立てない）。
 */
export function installEvidenceOpener(
  root: HTMLElement,
  options: EvidenceOpenerOptions,
): () => void {
  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const path = target.closest<HTMLElement>('.evidence-open')?.dataset['path'];
    if (path === undefined) return;
    if (options.bridge === undefined) {
      options.onError(t('verdict.openOutside'));
      return;
    }
    options.bridge.open(path, 'reveal').catch((error: unknown) => {
      options.onError(
        t('verdict.openFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

export async function startMenuActions(options: MenuActionOptions): Promise<void> {
  const bridge = 'bridge' in options ? options.bridge : tauriOpenSheetBridge();

  await bridge?.subscribe((action) => {
    const mode = MODES[action];
    // 知らない項目は無視する（外観や言語のメニューはここへ来ない）。
    if (mode === undefined) return;

    const path = options.sheetPath();
    if (path === undefined) {
      // 押しても何も起きない、を作らない。
      options.onError(t('sheet.none'));
      return;
    }

    bridge.open(path, mode).catch((error: unknown) => {
      options.onError(
        t('sheet.openFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  });
}
