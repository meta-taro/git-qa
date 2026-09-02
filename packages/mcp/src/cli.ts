import { createAndroidAdapter } from '@git-qa/adapter-android';

import { createMcpServer, serveOverStdio } from './server.js';
import { createDeviceTools } from './tools.js';

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

await serveOverStdio(createMcpServer(tools));
