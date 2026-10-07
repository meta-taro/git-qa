/**
 * **iPhone / iPad を押す口**（WebDriverAgent・2026-10-06 に作ると決めた・C99）。
 *
 * WebDriverAgent（WDA）は端末の中で動く HTTP の口で、押す・打つをここへ頼む。
 * **署名して端末へ入れるのは人の作業**（Apple の開発者アカウント・秘密情報を扱うので AI はしない）。
 * git-qa は、人が起こした口（例 `http://127.0.0.1:8100`）を使うだけ。
 *
 * **映像は画素、WDA はポイント**を受け取る。押す前に倍率で割る（iPhone はふつう 3 倍）。
 */

/** 試験で差し替えるための、`fetch` の要るところだけ。 */
export type WdaFetch = (
  url: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface WdaClient {
  /** 口が生きているか。**聞けなければ false**（押せるつもりで進めない）。 */
  ready(): Promise<boolean>;
  /** 画素とポイントの倍率。 */
  scale(): Promise<number>;
  /** ポイントの座標を押す（指を置いて離す）。 */
  tap(at: { x: number; y: number }): Promise<void>;
  /** いま焦点のある欄へ打つ。 */
  type(text: string): Promise<void>;
  /**
   * 画面の絵（PNG）。**USB で映す口を使わない**（2026-10-07）。映す口は前のプロセスが手放した直後に
   * 10 秒以上見えなくなり、手順ごとに撮ると必ず落ちた。
   */
  screenshot(): Promise<Uint8Array>;
  /** なぞる（ポイントの座標で・`durationMs` かけて動かす）。 */
  swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs: number,
  ): Promise<void>;
}

/** 断られた理由ごと持ち運ぶ（セッションの作り直しの判断に要る）。 */
class WdaRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createWdaClient(baseUrl: string, fetchImpl: WdaFetch = fetch): WdaClient {
  const base = baseUrl.replace(/\/+$/, '');
  let sessionId: string | undefined;

  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    let res: Awaited<ReturnType<WdaFetch>>;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error: unknown) {
      // **口が居ないことを、押せたことにしない。**次に何を見ればよいかを添える。
      throw new Error(
        `WebDriverAgent に届かない（${base}）: ${error instanceof Error ? error.message : String(error)}。` +
          '端末で WebDriverAgent が起きているか、口（ポート）が繋がっているかを見てください',
      );
    }
    const said = await res.json().catch(() => undefined);
    if (!res.ok) {
      throw new WdaRefused(
        `WebDriverAgent が断った（${String(res.status)} ${method} ${path}）`,
        res.status,
      );
    }
    return said;
  };

  const session = async (): Promise<string> => {
    if (sessionId !== undefined) return sessionId;
    const said = (await call('POST', '/session', { capabilities: {} })) as {
      sessionId?: string;
      value?: { sessionId?: string };
    };
    const id = said.sessionId ?? said.value?.sessionId;
    if (id === undefined) throw new Error('WebDriverAgent がセッションを返さなかった');
    sessionId = id;
    return id;
  };

  /**
   * セッションを使う呼び出し。**セッションが消えていたら（404）、作り直して 1 回だけやり直す**
   * （2026-10-07・実機で踏んだ）。WDA はセッションを 1 つしか持てず、別の誰かが作ると前のものは消える。
   */
  const inSession = async (method: string, tail: string, body?: unknown): Promise<unknown> => {
    try {
      return await call(method, `/session/${await session()}${tail}`, body);
    } catch (error: unknown) {
      if (!(error instanceof WdaRefused) || error.status !== 404) throw error;
      sessionId = undefined;
      return call(method, `/session/${await session()}${tail}`, body);
    }
  };

  const fingerMoves = (moves: readonly Record<string, unknown>[]): unknown => ({
    actions: [
      { type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions: moves },
    ],
  });

  return {
    async ready() {
      try {
        const said = (await call('GET', '/status')) as { value?: { ready?: boolean } };
        return said.value?.ready !== false;
      } catch {
        return false;
      }
    },

    async scale() {
      const said = (await inSession('GET', '/wda/screen')) as {
        value?: { scale?: number };
      };
      return said.value?.scale ?? 1;
    },

    async tap(at) {
      await inSession(
        'POST',
        '/actions',
        fingerMoves([
          { type: 'pointerMove', duration: 0, x: Math.round(at.x), y: Math.round(at.y) },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerUp', button: 0 },
        ]),
      );
    },

    async type(text) {
      await inSession('POST', '/wda/keys', { value: [...text] });
    },

    async screenshot() {
      const said = (await call('GET', '/screenshot')) as { value?: string };
      if (typeof said.value !== 'string')
        throw new Error('WebDriverAgent が画面の絵を返さなかった');
      return new Uint8Array(Buffer.from(said.value, 'base64'));
    },

    async swipe(from, to, durationMs) {
      await inSession(
        'POST',
        '/actions',
        fingerMoves([
          { type: 'pointerMove', duration: 0, x: Math.round(from.x), y: Math.round(from.y) },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 100 },
          { type: 'pointerMove', duration: durationMs, x: Math.round(to.x), y: Math.round(to.y) },
          { type: 'pointerUp', button: 0 },
        ]),
      );
    },
  };
}

/** 画素の座標をポイントへ。 */
export function toPoints(at: { x: number; y: number }, scale: number): { x: number; y: number } {
  const by = scale > 0 ? scale : 1;
  return { x: at.x / by, y: at.y / by };
}

/**
 * 絵から読んだ文字（`文字 \t x \t y \t 幅 \t 高さ`・x / y は真ん中）から、押す所を決める。
 * **完全一致を先に、その中でいちばん小さいもの。**無ければ部分一致のいちばん小さいもの。
 * **見つからなければ undefined**（当てずっぽうで押さない）。
 */
export function pickByText(
  ocr: string,
  ref: string,
): { x: number; y: number; width: number; height: number } | undefined {
  const squeeze = (value: string): string => value.replace(/\s+/g, '');
  const want = squeeze(ref);
  const lines = ocr
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((cells) => cells.length >= 5 && cells[0] !== '')
    .map(([text = '', x, y, w, h]) => ({
      text,
      x: Number(x),
      y: Number(y),
      width: Number(w),
      height: Number(h),
    }))
    .filter((one) => [one.x, one.y, one.width, one.height].every(Number.isFinite));
  const bySize = (a: { width: number; height: number }, b: { width: number; height: number }) =>
    a.width * a.height - b.width * b.height;
  const exact = lines.filter((one) => squeeze(one.text) === want).sort(bySize);
  const partial = lines.filter((one) => squeeze(one.text).includes(want)).sort(bySize);
  const best = exact[0] ?? partial[0];
  return best === undefined
    ? undefined
    : { x: best.x, y: best.y, width: best.width, height: best.height };
}
