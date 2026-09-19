import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createAndroidAdapter } from '@git-qa/adapter-android';
import { createDesktopAdapter, readDesktopScreenText, whyNoDesktop } from '@git-qa/adapter-desktop';
import { createIosAdapter, readIosScreenText } from '@git-qa/adapter-ios';
import { createWebAdapter, readWebScreenText } from '@git-qa/adapter-web';
import type { TargetSession } from '@git-qa/core';

import { findIosTool, findOcrTool } from './ios-tool.js';
import { mcpTargetFrom, targetHint } from './target.js';

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

/**
 * **触る相手を選ぶ**（人の指示・2026-09-17）。
 *
 * > 全自動でテスト動画をとる場合、エージェントの操作は必須となります。
 *
 * 道具（`tools.ts`）は元からアダプタ非依存で、**ここの配線だけが Android 固定**だった。
 * ウェブ・デスクトップも触れるようにする。**既定は今までどおり Android。**
 */
const target = mcpTargetFrom(process.env);
const label = process.env['GIT_QA_APP_LABEL'] ?? 'dev';

/** iPhone / iPad を映す道具と、絵から文字を読む道具。**無ければ、その相手は見られない。** */
const toolPath = target.kind === 'ios' ? await findIosTool() : undefined;
const ocrPath = target.kind === 'ios' ? await findOcrTool() : undefined;

const connect = (): Promise<TargetSession> => {
  if (target.kind === 'web') {
    return createWebAdapter({
      build: { source: target.url, label },
      url: target.url,
      destination: target.url,
      // 同じ幅で見ないと、崩れの有無を比べられない。
      size: { width: 1280, height: 900 },
      // **既に起きているブラウザにも繋げる**（#30）。Playwright が前準備を済ませた先。
      ...(target.attachTo === undefined ? {} : { attachTo: target.attachTo }),
      ...(process.env['GIT_QA_PROFILE'] === undefined
        ? {}
        : { userDataDir: process.env['GIT_QA_PROFILE'] }),
    }).connect();
  }

  if (target.kind === 'desktop') {
    const why = whyNoDesktop(process.platform, undefined);
    if (why !== undefined) throw new Error(why);
    return createDesktopAdapter({
      app: target.app,
      build: { source: target.app, label },
      destination: target.app,
    }).connect();
  }

  if (target.kind === 'ios') {
    /**
     * iPhone / iPad（2026-09-19・C75）。**押す口は無い。**
     *
     * **道具が無ければ、見ることもできない**（`git-qa-ocr` と違い代わりの道が無い）ので、
     * ここで理由を言って止まる。
     */
    if (toolPath === undefined) {
      throw new Error(
        'iPhone / iPad を映す道具が無い（macOS で pnpm build すると建ちます）。場所を渡すなら GIT_QA_IOS',
      );
    }
    return createIosAdapter({
      toolPath,
      ...(target.device === undefined ? {} : { device: target.device }),
      ...(ocrPath === undefined ? {} : { ocrPath }),
      build: { source: process.env['GIT_QA_APP_SOURCE'] ?? 'ios', label },
    }).connect();
  }

  return createAndroidAdapter({
    build: {
      source: process.env['GIT_QA_APP_SOURCE'] ?? 'example/sample-notes-app',
      label,
    },
    ...(target.serial === undefined ? {} : { serial: target.serial }),
  }).connect();
};

/** **画面の文字の読み方は相手ごとに違う。**ここで取り違えると、AI は空の画面を見る。 */
const readScreenText =
  target.kind === 'web'
    ? readWebScreenText
    : target.kind === 'desktop'
      ? readDesktopScreenText
      : target.kind === 'ios'
        ? readIosScreenText
        : undefined;

const tools = createDeviceTools({
  connect,
  ...(readScreenText === undefined ? {} : { readScreenText }),
});

console.error(`[git-qa] ${targetHint(target)}`);

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
