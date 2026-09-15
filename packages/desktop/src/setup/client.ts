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

/** `'done'` は**走り終えた**（外部レビュー meta-taro/git-qa#5）。次を始められる。 */
export type SetupPhase = 'idle' | 'starting' | 'running' | 'done' | 'failed';

/**
 * 途中で止まった実行（2026-09-12・人の指示）。
 *
 * **どこまで人が見て置いたか**を添える。選ぶときに、いちばん知りたいのがそこ。
 */
export interface SetupResumable {
  readonly runId: string;
  readonly sheetPath: string;
  readonly startedAt: string;
  readonly cases: number;
  readonly placed: number;
}

export interface SetupState {
  readonly phase: SetupPhase;
  readonly devices: readonly SetupDevice[];
  readonly sheets: readonly string[];
  /** 途中で止まった実行。**古い実行器と繋いだときは持たない。** */
  readonly resumable?: readonly SetupResumable[];
  /** 端末の一覧を取れなかった理由（`adb` が入っていない機械では普通に起きる）。 */
  readonly deviceError?: string;
  readonly liveUrl?: string;
  readonly controlUrl?: string;
  /** 流れてくる映像の種類。**画面側では決められない**ので、実行器が知らせる（C54）。 */
  readonly liveKind?: 'h264' | 'images';
  readonly error?: string;
}

const PHASES: readonly SetupPhase[] = ['idle', 'starting', 'running', 'done', 'failed'];

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

  /**
   * 途中で止まった実行。**形のおかしいものは落とす。**
   * 当て推量で「4 件置いた」と出すと、人がそれを見て選ぶことになる。
   */
  const count = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0;
  const resumable = Array.isArray(raw['resumable'])
    ? raw['resumable'].filter(
        (item): item is SetupResumable =>
          isRecord(item) &&
          typeof item['runId'] === 'string' &&
          typeof item['sheetPath'] === 'string' &&
          typeof item['startedAt'] === 'string' &&
          count(item['cases']) &&
          count(item['placed']),
      )
    : undefined;

  const kind = text('liveKind');
  const liveKind = kind === 'h264' || kind === 'images' ? kind : undefined;

  return {
    phase: phase as SetupPhase,
    devices,
    sheets: asStrings(raw['sheets']),
    ...(text('liveUrl') === undefined ? {} : { liveUrl: text('liveUrl') as string }),
    /**
     * **映像の種類は、実行器が知らせる**（C54・meta-taro/git-qa#18）。
     *
     * ここで写し忘れていたので、画面は既定の `h264` で復号器を作り、
     * **JPEG を H.264 として流し込んでいた** —— 例外も出ず、記録にも何も出ず、
     * **ただ真っ白**になる。画面から始めた人だけが踏んでいた（CLI は URL に乗っている）。
     *
     * **知らない名前は受け取らない。**当て推量で選ぶと、また黙って白くなる。
     */
    ...(liveKind === undefined ? {} : { liveKind }),
    ...(text('controlUrl') === undefined ? {} : { controlUrl: text('controlUrl') as string }),
    ...(text('error') === undefined ? {} : { error: text('error') as string }),
    ...(text('deviceError') === undefined ? {} : { deviceError: text('deviceError') as string }),
    ...(resumable === undefined ? {} : { resumable }),
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
  params: {
    serial: string;
    sheetPath: string;
    operator?: string;
    browser?: string;
    browserPath?: string;
    /** **鑑賞モードで始める**（2026-09-11）。選ばれたときだけ持つ。 */
    watch?: true;
    /** **続きから**（2026-09-12）。止まった実行の ID。 */
    resume?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`${url}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (res.status !== 202) {
    // **断った側が書いた理由を捨てない。**`400` だけでは人は何をすればいいか分からない。
    const reason = await res.text().catch(() => '');
    throw new Error(
      reason.trim() === ''
        ? `実行を始められなかった（${String(res.status)}）`
        : `実行を始められなかった: ${reason.trim()}`,
    );
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
