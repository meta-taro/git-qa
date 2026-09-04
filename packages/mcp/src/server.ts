import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type { DeviceTools } from './tools.js';

/**
 * 端末を触るための MCP サーバ。
 *
 * **できるのは操作と取得だけ。**判定（`VERIFIED` 等）を置く道具は載せない。
 * 載せた瞬間、AI が「人が見た」と書けてしまい、この製品の芯が壊れる（C1 / C17）。
 *
 * ここは配線なので検査していない。判断のある所は `tools.ts` にあり、そちらは検査してある。
 */
export function createMcpServer(tools: DeviceTools): McpServer {
  const server = new McpServer({ name: 'git-qa', version: '0.0.0' });

  const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });

  server.registerTool(
    'device_tap',
    {
      title: '端末をタップする',
      description: '端末の画面を 1 点タップする。座標は端末の実寸（device_screen_size で取れる）。',
      inputSchema: { x: z.number().int().min(0), y: z.number().int().min(0) },
    },
    async ({ x, y }) => {
      await tools.tap(x, y);
      return ok(`タップした: (${String(x)}, ${String(y)})`);
    },
  );

  server.registerTool(
    'device_swipe',
    {
      title: '端末をなぞる（フリック / スワイプ）',
      description:
        '始点から終点へなぞる。かけた時間で速さが決まる（短いほどフリック）。座標は端末の実寸。',
      inputSchema: {
        fromX: z.number().int().min(0),
        fromY: z.number().int().min(0),
        toX: z.number().int().min(0),
        toY: z.number().int().min(0),
        durationMs: z.number().int().min(1).max(10_000).default(150),
      },
    },
    async ({ fromX, fromY, toX, toY, durationMs }) => {
      await tools.swipe({ x: fromX, y: fromY }, { x: toX, y: toY }, durationMs);
      return ok(
        `なぞった: (${String(fromX)}, ${String(fromY)}) → (${String(toX)}, ${String(toY)})`,
      );
    },
  );

  server.registerTool(
    'device_key',
    {
      title: '端末のキーを押す',
      description: 'HOME / BACK / APP_SWITCH / ENTER などのキーを送る。',
      inputSchema: { key: z.string().min(1) },
    },
    async ({ key }) => {
      await tools.key(key);
      return ok(`キーを送った: ${key}`);
    },
  );

  server.registerTool(
    'device_launch',
    {
      title: 'アプリを起動する',
      description:
        '端末側の識別子（Android ならパッケージ名。例 com.android.settings）で起動する。' +
        '表示名からは起動できない — どのパッケージかは端末と地域で変わるため（C40）。',
      inputSchema: { app: z.string().min(1) },
    },
    async ({ app }) => {
      await tools.launch(app);
      return ok(`起動した: ${app}`);
    },
  );

  server.registerTool(
    'device_type',
    {
      title: '端末に文字を送る',
      description:
        'いま入力先になっている欄へ文字を送る。端末の入力は IME を通らないので ASCII だけ。',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => {
      await tools.type(text);
      return ok(`送った: ${text}`);
    },
  );

  server.registerTool(
    'device_screenshot',
    { title: '端末の画面を撮る', description: 'いまの画面を PNG で返す。', inputSchema: {} },
    async () => {
      const shot = await tools.screenshot();
      return { content: [{ type: 'image' as const, data: shot.base64, mimeType: shot.mimeType }] };
    },
  );

  server.registerTool(
    'device_screen_text',
    {
      title: '画面で読める文字を取る',
      description: '画面に出ている文字（text と content-desc）を集めて返す。',
      inputSchema: {},
    },
    async () => ok(await tools.screenText()),
  );

  server.registerTool(
    'device_screen_size',
    { title: '端末の画面の実寸', description: '座標を決めるのに使う。', inputSchema: {} },
    async () => {
      const size = await tools.screenSize();
      return ok(`${String(size.width)}x${String(size.height)}`);
    },
  );

  return server;
}

export async function serveOverStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}
