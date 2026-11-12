/**
 * エージェントの専用カーソルへの指示（C120）。
 *
 * エージェントは git-qa 自身の画面を、**人のマウスを使わずに**指す・押す・打つ。
 * MCP の `screen` → 入口サーバの `POST …/agent` → 画面（SSE）→ 専用カーソルが動く。
 *
 * **判定や名乗りの近道ではない。**押せるのは、人が画面で押せるものと同じもの。
 * 判定のキーと名乗りの欄は、画面側が断る（C1 / C17）。
 *
 * ここは形の検査だけ。おかしければ理由つきで断る（黙って捨てると「届いたのに動かない」に見える）。
 */

/** 一言を出しておく秒数（省けば画面が文の長さで決める）。 */
interface Shown {
  readonly seconds?: number;
}

export type AgentAction =
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

export const AGENT_ACTIONS = ['point', 'click', 'type', 'go', 'say'] as const;
type ActionName = (typeof AGENT_ACTIONS)[number];

/** 画面に出す文字の上限（吹き出し・打つ文字）。 */
const MAX_TEXT = 500;
const MIN_SECONDS = 1;
const MAX_SECONDS = 60;

export class AgentActionError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function text(body: Record<string, unknown>, key: string, required: boolean): string | undefined {
  const value = body[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentActionError(`${key} は空でない文字で`);
  }
  if (value.length > MAX_TEXT) {
    throw new AgentActionError(`${key} が長すぎる（${String(MAX_TEXT)} 文字まで）`);
  }
  return value;
}

function seconds(body: Record<string, unknown>): number | undefined {
  const value = body['seconds'];
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < MIN_SECONDS ||
    value > MAX_SECONDS
  ) {
    throw new AgentActionError(`seconds は ${String(MIN_SECONDS)}〜${String(MAX_SECONDS)} の数で`);
  }
  return value;
}

/** 受けた JSON を、画面に流してよい指示にする。おかしければ理由つきで断る。 */
export function parseAgentAction(body: unknown): AgentAction {
  if (!isRecord(body)) throw new AgentActionError('指示は JSON の物（{ action: … }）で');
  const action = body['action'];
  if (action === 'filter') {
    // tadori の仕様にはあるが、git-qa の画面には人で絞る欄が無い。**無いと言う。**
    throw new AgentActionError('git-qa の画面には人で絞る欄が無い（filter は使えない）');
  }
  if (!AGENT_ACTIONS.includes(action as ActionName)) {
    throw new AgentActionError(
      `知らない action: ${String(action)}（使えるのは ${AGENT_ACTIONS.join(' / ')}）`,
    );
  }
  const name = action as ActionName;
  const message = text(body, 'message', name === 'say');
  const shown = {
    ...(message === undefined ? {} : { message }),
    ...((): Shown => {
      const value = seconds(body);
      return value === undefined ? {} : { seconds: value };
    })(),
  };

  switch (name) {
    case 'say':
      return { action: name, ...shown, message: message as string };
    case 'go': {
      const hash = text(body, 'hash', true) as string;
      // 画面の中の移動だけ。**外のページへは移らせない。**
      if (!hash.startsWith('#')) {
        throw new AgentActionError('hash は画面の中の場所（# で始まる）で');
      }
      return { action: name, hash, ...shown };
    }
    case 'type':
      return {
        action: name,
        target: text(body, 'target', true) as string,
        value: text(body, 'value', true) as string,
        ...shown,
      };
    default:
      return { action: name, target: text(body, 'target', true) as string, ...shown };
  }
}
