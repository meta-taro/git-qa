/**
 * Safari とのやりとり（WebDriver・Issue 018 / C56）。
 *
 * **3 本目の約束。**Chrome は CDP、Firefox は BiDi、Safari は WebDriver。
 * WebDriver だけ **HTTP**（WebSocket ではない）。
 *
 * `safaridriver` は OS 付属なので、**依存はまた足さない。**
 *
 * **人が 1 回だけ設定する所がある。**実測（2026-09-06）で返ってきた文:
 * `You must enable 'Allow remote automation' in the Developer section of Safari Settings`
 */

export interface WebDriverClient {
  /** 開いた画面の番号。開く前は undefined。 */
  readonly sessionId: string | undefined;
  open(): Promise<void>;
  /** 命令を 1 つ投げて、返ってきた値を取り出す。 */
  post(path: string, body: unknown): Promise<unknown>;
  get(path: string): Promise<unknown>;
  close(): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** 断られた理由を読む。**Safari が書いた文をそのまま渡す**（言い換えると原因が絞れない）。 */
function reasonOf(body: unknown): string {
  if (!isRecord(body)) return JSON.stringify(body);
  const value = body['value'];
  if (isRecord(value) && typeof value['message'] === 'string') return value['message'];
  return JSON.stringify(body);
}

export function createWebDriverClient(
  base: string,
  fetchImpl: typeof fetch = fetch,
): WebDriverClient {
  let sessionId: string | undefined;

  const call = async (method: string, url: string, body?: unknown): Promise<unknown> => {
    const response = await fetchImpl(url, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new Error(`${method} ${url} を断られた: ${reasonOf(parsed)}`);
    }
    return isRecord(parsed) ? parsed['value'] : undefined;
  };

  const withSession = (path: string): string => {
    if (sessionId === undefined) {
      // **開く前に投げない。**投げると、どこへ届いたのか分からない形で落ちる。
      throw new Error(`画面を開く前に命令を出した: ${path}`);
    }
    return `${base}/session/${sessionId}${path}`;
  };

  return {
    get sessionId() {
      return sessionId;
    },

    async open() {
      const value = await call('POST', `${base}/session`, {
        capabilities: { alwaysMatch: { browserName: 'safari' } },
      });
      const id = isRecord(value) ? value['sessionId'] : undefined;
      if (typeof id !== 'string') {
        throw new Error(`画面を開けなかった: ${JSON.stringify(value)}`);
      }
      sessionId = id;
    },

    post: (path, body) => Promise.resolve().then(() => call('POST', withSession(path), body)),
    get: (path) => Promise.resolve().then(() => call('GET', withSession(path))),

    async close() {
      if (sessionId === undefined) return;
      const id = sessionId;
      sessionId = undefined;
      await call('DELETE', `${base}/session/${id}`).catch(() => undefined);
    },
  };
}

/** W3C の入力 1 つ分。 */
export interface W3cAction {
  readonly type: string;
  readonly x?: number;
  readonly y?: number;
  readonly value?: string;
  readonly button?: number;
  readonly duration?: number;
}

export interface W3cActionGroup {
  readonly type: 'pointer' | 'key';
  readonly id: string;
  readonly parameters?: { readonly pointerType: string };
  readonly actions: readonly W3cAction[];
}

/**
 * 押す動き。**指の種類まで書く**のが BiDi との違い。
 * 動かしてから押す —— **hover でしか出ないものがある。**
 */
export function w3cPointer(point: { x: number; y: number }): W3cActionGroup[] {
  return [
    {
      type: 'pointer',
      id: 'mouse',
      parameters: { pointerType: 'mouse' },
      actions: [
        { type: 'pointerMove', x: point.x, y: point.y, duration: 0 },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ];
}

/** 文字を打つ動き。**1 文字ずつ、押して離す。**日本語もそのまま送れる。 */
export function w3cType(text: string): W3cActionGroup[] {
  const actions: W3cAction[] = [];
  for (const character of [...text]) {
    actions.push({ type: 'keyDown', value: character });
    actions.push({ type: 'keyUp', value: character });
  }
  return [{ type: 'key', id: 'keyboard', actions }];
}

/** 掴んで、途中を通ってから離す。**1 回で運ぶと並べ替えの UI では何も起きない。** */
export function w3cDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10,
): W3cActionGroup[] {
  const actions: W3cAction[] = [
    { type: 'pointerMove', x: from.x, y: from.y, duration: 0 },
    { type: 'pointerDown', button: 0 },
  ];
  for (let i = 1; i <= steps; i += 1) {
    actions.push({
      type: 'pointerMove',
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
      duration: 20,
    });
  }
  actions.push({ type: 'pointerUp', button: 0 });
  return [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions }];
}
