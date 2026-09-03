import { localHttpUrlFromLocation } from '../local-url.js';

/**
 * 入口サーバ（`@git-qa/host`）との線。
 *
 * **状態は取りに行く（polling）。**選ぶ画面は遅れに厳しくないので、
 * 仕掛けを増やすより取りに行くほうが部品が少なくて済む。
 */

export interface SetupDevice {
  readonly serial: string;
  readonly state: string;
}

export type SetupPhase = 'idle' | 'starting' | 'running' | 'failed';

export interface SetupState {
  readonly phase: SetupPhase;
  readonly devices: readonly SetupDevice[];
  readonly sheets: readonly string[];
  readonly liveUrl?: string;
  readonly controlUrl?: string;
  readonly error?: string;
}

const PHASES: readonly SetupPhase[] = ['idle', 'starting', 'running', 'failed'];

/** `?setup=<url>` から読む。規則は映像・制御と同じ。 */
export function setupUrlFromLocation(search: string): string | undefined {
  return localHttpUrlFromLocation(search, 'setup');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function parseSetupState(raw: unknown): SetupState | undefined {
  if (!isRecord(raw)) return undefined;
  const phase = raw['phase'];
  if (typeof phase !== 'string' || !(PHASES as readonly string[]).includes(phase)) return undefined;

  const devices = Array.isArray(raw['devices'])
    ? raw['devices'].filter(
        (item): item is SetupDevice =>
          isRecord(item) && typeof item['serial'] === 'string' && typeof item['state'] === 'string',
      )
    : [];

  const text = (key: string): string | undefined =>
    typeof raw[key] === 'string' ? raw[key] : undefined;

  return {
    phase: phase as SetupPhase,
    devices,
    sheets: asStrings(raw['sheets']),
    ...(text('liveUrl') === undefined ? {} : { liveUrl: text('liveUrl') as string }),
    ...(text('controlUrl') === undefined ? {} : { controlUrl: text('controlUrl') as string }),
    ...(text('error') === undefined ? {} : { error: text('error') as string }),
  };
}

/**
 * いまの状態を読む。**読めなければ `undefined`。**
 * 落とさないのは、入口サーバが立ち上がる前でも画面を出したいため。
 */
export async function fetchSetupState(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SetupState | undefined> {
  try {
    const res = await fetchImpl(`${url}/state`);
    if (!res.ok) return undefined;
    return parseSetupState(await res.json());
  } catch {
    return undefined;
  }
}

/**
 * 選んだ端末とシートで始めてもらう。
 *
 * **断られたら落とす。**押したのに始まっていない状態で黙ると、人は待ち続ける。
 */
export async function requestStart(
  url: string,
  params: { serial: string; sheetPath: string; operator?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${url}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (res.status !== 202) {
    throw new Error(`実行を始められなかった: ${String(res.status)}`);
  }
}

export interface ResolveSetupUrlOptions {
  /** アプリ（Rust 側）に聞く口。差し替えられる形にしてある。 */
  readonly ask?: () => Promise<string | null>;
  readonly waitMs?: number;
  readonly tries?: number;
}

/**
 * 入口サーバの URL を決める。
 *
 * **配布物ではクエリで渡せない。**開発中（`pnpm app`）は `?setup=` が付くが、
 * `.app` を叩いたときは付かないので、Node 側を起こしたアプリに聞く。
 * **起こせなかった理由はそのまま投げる**（黙って空の画面を出さない）。
 */
export async function resolveSetupUrl(
  search: string,
  options: ResolveSetupUrlOptions = {},
): Promise<string | undefined> {
  const fromQuery = setupUrlFromLocation(search);
  if (fromQuery !== undefined) return fromQuery;

  const ask =
    options.ask ??
    (async (): Promise<string | null> => {
      if (!('__TAURI_INTERNALS__' in window)) return null;
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string | null>('setup_url');
    });

  const tries = options.tries ?? 40;
  const waitMs = options.waitMs ?? 250;

  for (let i = 0; i < tries; i += 1) {
    const url = await ask();
    if (url !== null && url !== '') return url;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return undefined;
}

/**
 * 検証シートを人に選んでもらう。
 *
 * **配布物では作業ディレクトリが `/` になる**ので、探して並べるだけでは足りない
 * （実機で「検証シートが無い」と出た）。ブラウザで開いているときは何もしない。
 */
export async function pickSheet(): Promise<string | undefined> {
  if (!('__TAURI_INTERNALS__' in window)) return undefined;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({
    multiple: false,
    directory: false,
    filters: [{ name: '検証シート', extensions: ['tsv'] }],
  });
  return typeof chosen === 'string' ? chosen : undefined;
}
