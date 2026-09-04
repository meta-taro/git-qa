import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { createAndroidAdapter } from '@git-qa/adapter-android';

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
 * macOS では画面収録とアクセシビリティの許可が要る（許可が無ければ理由が返る）。
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

await serveOverStdio(createMcpServer(tools, { captureWindow }));
