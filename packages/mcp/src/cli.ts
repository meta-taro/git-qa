import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createAndroidAdapter } from '@git-qa/adapter-android';

import { renderAbout } from './about.js';
import { createWindowCapture } from './screen.js';
import { createMcpServer, serveOverStdio } from './server.js';
import { createDeviceTools } from './tools.js';

const run = promisify(execFile);

/**
 * 端末を触るための MCP サーバを立てる。
 *
 *   pnpm mcp
 *
 * **判定を置く道具は載せていない。**合否は人だけが置く（C1 / C17）。
 * **ここは配線なので検査していない。**
 */

const tools = createDeviceTools({
  connect: () =>
    createAndroidAdapter({
      build: {
        source: process.env['GIT_QA_APP_SOURCE'] ?? 'example/sample-notes-app',
        label: process.env['GIT_QA_APP_LABEL'] ?? 'dev',
      },
      ...(process.env['GIT_QA_ANDROID_SERIAL'] === undefined
        ? {}
        : { serial: process.env['GIT_QA_ANDROID_SERIAL'] }),
    }).connect(),
});

// 落ちるときも端末を離す。掴んだままにすると、次に繋げない。
const release = (): void => {
  void tools.close().finally(() => process.exit(0));
};
process.on('SIGINT', release);
process.on('SIGTERM', release);

/**
 * git-qa 自身の窓を撮る。**AI が自分の画面を見るための口。**
 * macOS では画面収録の許可が要る（許可が無ければ理由が返る）。
 */
const captureWindow = createWindowCapture({
  run: async (command, args) => (await run(command, [...args])).stdout,
  readFile: async (path) => {
    const bytes = await readFile(path);
    // 撮った絵は残さない。**人の画面が temp に溜まり続けるのは、頼まれていない。**
    await rm(path, { force: true });
    return bytes;
  },
  tmpPath: () => join(tmpdir(), `git-qa-window-${String(Date.now())}.png`),
});

/**
 * この道具の説明を組み立てる（`about`）。
 *
 * **文書を正本にする**（`docs/agent-brief.md` / `CHANGELOG.md`）。
 * ここに文字列を埋めると、文書と実装がずれる（§10「古い文書は、無い文書より悪い」）。
 *
 * **概要が読めなければ、読めないと言う。**黙って空を返すと、
 * 聞いた側は「そういう道具なのだ」と受け取ってしまう。
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const readAbout = async (options: { version?: string }): Promise<string> => {
  const read = async (name: string): Promise<string | undefined> => {
    try {
      return await readFile(join(repoRoot, name), 'utf8');
    } catch {
      // 無いこと自体はあり得る（配布物の形によっては同梱していない）。**言う。**
      return undefined;
    }
  };

  const brief = await read('docs/agent-brief.md');
  if (brief === undefined) {
    return '**概要の文書（docs/agent-brief.md）を読めなかった。**git-qa は、人と AI で動作検証をする道具。';
  }

  return renderAbout({
    brief,
    changelog: await read('CHANGELOG.md'),
    ...(options.version === undefined ? {} : { version: options.version }),
  });
};

await serveOverStdio(createMcpServer(tools, { captureWindow, readAbout }));
