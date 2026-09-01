import { spawn } from 'node:child_process';

import type { CommandResult, CommandRunner, StreamingProcess } from './command.js';

/** 本物のプロセスを起動する実装。テストからは使わない。 */
export function createNodeCommandRunner(): CommandRunner {
  return {
    run(command, args) {
      return new Promise<CommandResult>((resolve, reject) => {
        const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        const out: Buffer[] = [];
        let err = '';
        child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
        // 起動そのものに失敗した場合（コマンドが無い等）は close が来ないので、ここで返す。
        child.on('error', reject);
        child.on('close', (code) => {
          resolve({ code: code ?? -1, stdout: new Uint8Array(Buffer.concat(out)), stderr: err });
        });
      });
    },

    stream(command, args): StreamingProcess {
      const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'ignore'] });
      let running = true;
      // 受け手が読むより速く届くので、溜める。捨てると映像に穴が空く。
      const queue: Uint8Array[] = [];
      let wake: (() => void) | undefined;
      const bump = (): void => {
        wake?.();
        wake = undefined;
      };

      child.stdout.on('data', (chunk: Buffer) => {
        queue.push(new Uint8Array(chunk));
        bump();
      });
      const finish = (): void => {
        running = false;
        bump();
      };
      child.on('close', finish);
      child.on('error', finish);

      return {
        get isRunning() {
          return running;
        },
        async stop() {
          if (!running) return;
          child.kill('SIGTERM');
          await new Promise<void>((resolve) => child.on('close', () => resolve()));
        },
        chunks: {
          async *[Symbol.asyncIterator]() {
            for (;;) {
              const next = queue.shift();
              if (next !== undefined) {
                yield next;
                continue;
              }
              if (!running) return;
              await new Promise<void>((resolve) => (wake = resolve));
            }
          },
        },
      };
    },

    start(command, args) {
      const child = spawn(command, [...args], { stdio: ['ignore', 'ignore', 'ignore'] });
      let running = true;
      const done = new Promise<void>((resolve) => {
        child.on('close', () => {
          running = false;
          resolve();
        });
        child.on('error', () => {
          running = false;
          resolve();
        });
      });

      return {
        get isRunning() {
          return running;
        },
        async stop() {
          if (!running) return;
          child.kill('SIGTERM');
          await done;
        },
      };
    },
  };
}
