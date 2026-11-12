import type { ScreenRecord } from '@git-qa/host';

/**
 * MCP の `screen`：git-qa **自身の画面**の専用カーソルを動かす（C120）。
 *
 * 端末（検証の相手）を触る `device_*` とは別物。**人のマウス・キーボードは使わない。**
 * 開いている画面は、入口を開いたプロセスが置いた名乗り（`~/.git-qa/screens`）から探す。
 * 名乗りにあるのは**置く口**の URL だけ（入口の文字列ではない）。
 *
 * **置いたら返す。**画面がどう動いたかは待たない（`app_screenshot` で見る）。
 */

export interface ScreenDeps {
  /** 開いている画面（新しいものが先）。 */
  readonly findScreens: () => Promise<readonly ScreenRecord[]>;
  /** 1 つの画面の置く口へ置く。繋がらなければ投げる。 */
  readonly post: (url: string, body: unknown) => Promise<{ status: number; text: string }>;
  /** 繋がらなかった名乗りを外す（残骸。配布物では終わり際の合図が通らない）。 */
  readonly forget?: (screen: ScreenRecord) => void;
}

export interface ScreenResult {
  readonly ok: boolean;
  readonly text: string;
}

export async function sendToScreens(deps: ScreenDeps, body: unknown): Promise<ScreenResult> {
  const screens = await deps.findScreens();
  if (screens.length === 0) {
    return {
      ok: false,
      text: 'git-qa の画面が開いていない。アプリ（または pnpm app）を開いてから呼んでください',
    };
  }

  let delivered = 0;
  const problems: string[] = [];
  for (const screen of screens) {
    const who = `${screen.release}・pid ${String(screen.pid)}`;
    try {
      const res = await deps.post(screen.url, body);
      if (res.status === 202) {
        delivered += 1;
      } else if (res.status === 404) {
        problems.push(
          `その git-qa（${screen.release}）には画面を動かす口が無い。この口が入った版に入れ替えてください`,
        );
      } else {
        problems.push(
          res.text.trim() === '' ? `画面（${who}）が ${String(res.status)} を返した` : res.text,
        );
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      problems.push(`画面（${who}）に届かない: ${reason}。名乗りを外した`);
      deps.forget?.(screen);
    }
  }

  if (delivered === 0) return { ok: false, text: problems.join('\n') };
  const head = `届けた（画面 ${String(delivered)} 枚）。専用カーソルが人の画面で動く`;
  return { ok: true, text: problems.length === 0 ? head : `${head}\n${problems.join('\n')}` };
}

/** 本物の口（`fetch`）。**待ちすぎない** —— 返らない画面は、届かないと同じ。 */
export async function postJson(
  url: string,
  body: unknown,
  timeoutMs = 5_000,
): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, text: await res.text().catch(() => '') };
}
