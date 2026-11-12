import { parseCommand } from './types.js';
import type { AgentCommand } from './types.js';

/**
 * 入口サーバからの指示を受ける線（C120）。
 *
 * `GET <setup>/agent/events`（SSE）。**届いた順に 1 つずつ**実行する（前の動きが終わってから次へ）。
 * 切れたら `EventSource` が自分で繋ぎ直す。
 */

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

export function watchAgentEvents(
  setupUrl: string,
  run: (command: AgentCommand) => Promise<void>,
  open: (url: string) => EventSourceLike = (url) => new EventSource(url),
  onFailure: (reason: string) => void = (reason) =>
    console.warn('[git-qa] エージェントの操作に失敗した:', reason),
): () => void {
  const events = open(`${setupUrl}/agent/events`);
  let queue = Promise.resolve();
  events.addEventListener('agent', (event) => {
    const command = parseCommand(event.data);
    // 壊れた知らせは捨てる（サーバーが検査済みの形しか流さない）。
    if (command === undefined) return;
    queue = queue
      .then(() => run(command))
      .catch((error: unknown) => {
        onFailure(error instanceof Error ? error.message : String(error));
      });
  });
  return () => events.close();
}
