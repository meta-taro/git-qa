/**
 * エージェントの専用カーソルへの指示（C120）。
 *
 * 形の正本は入口サーバ（`@git-qa/host` の `agent-action.ts`）。ここへは検査済みのものだけが流れてくる。
 * 画面側は Node を知らないので、型だけを持つ。
 */
interface Shown {
  readonly seconds?: number;
}

export type AgentCommand =
  | ({ readonly action: 'point'; readonly target: string; readonly message?: string } & Shown)
  | ({ readonly action: 'click'; readonly target: string; readonly message?: string } & Shown)
  | ({
      readonly action: 'type';
      readonly target: string;
      readonly value: string;
      readonly message?: string;
    } & Shown)
  | ({ readonly action: 'go'; readonly hash: string; readonly message?: string } & Shown)
  | ({ readonly action: 'say'; readonly message: string } & Shown);

const ACTIONS = new Set(['point', 'click', 'type', 'go', 'say']);

/** 届いた文字を指示として読む。読めなければ undefined（サーバーが検査済みの形しか流さない）。 */
export function parseCommand(text: string): AgentCommand | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const action = (parsed as { action?: unknown }).action;
  if (typeof action !== 'string' || !ACTIONS.has(action)) return undefined;
  return parsed as AgentCommand;
}
