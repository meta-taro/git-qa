import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TargetAdapter } from '@git-qa/core';
import type { LiveBridge, LiveBridgeOptions } from '@git-qa/live-bridge';

import { startLiveSession } from './live-session.js';

/**
 * 端末に繋いでから画面を起こし、画面が閉じたら端末を離す。**最後の 1 本。**
 */

export interface RunWithLiveViewOptions {
  readonly adapter: TargetAdapter;
  /** 画面を起こす。閉じられるまで待つ。 */
  readonly launch: (liveUrl: string) => Promise<void>;
  readonly startBridge?: (options: LiveBridgeOptions) => Promise<LiveBridge>;
}

export async function runWithLiveView(options: RunWithLiveViewOptions): Promise<void> {
  // **先に端末へ繋ぐ。**繋がらないまま画面を出すと、映らないのか繋いでいないのかが
  // 人に分からなくなる。
  const live = await startLiveSession({
    adapter: options.adapter,
    ...(options.startBridge === undefined ? {} : { startBridge: options.startBridge }),
  });

  try {
    await options.launch(live.liveUrl);
  } finally {
    // 人が窓を閉じたのに端末を掴んだままにしない。落ちた場合も同じ。
    await live.close();
  }
}

/** 画面（Tauri）の起こし方。**どう起こすかを 1 箇所に持つ。** */
export interface DesktopLaunch {
  /** 起こす実行ファイル。**いま走っている node。** */
  readonly command: string;
  /** Tauri の CLI と、そこへ渡す引数。 */
  readonly args: readonly string[];
  /** `tauri.conf.json` のある場所。 */
  readonly cwd: string;
}

/**
 * 画面（Tauri）を起こすための一式を組み立てる（2026-09-12・Windows 機で実測して足した）。
 *
 * それまでは `spawn('pnpm', ['--filter', …, 'exec', 'tauri', …])` だった。
 * **Windows では 1 度も起きない。**
 *
 * ```text
 * Error: spawn pnpm ENOENT
 * ```
 *
 * Windows の `pnpm` の実体は `pnpm.cmd` で、**Node は拡張子を補わない。**
 *
 * **shell を噛ませて直すのは採らない。**`--config` へ渡す JSON には `"` が入っていて、
 * cmd.exe の引用で壊れる。Tauri の CLI は素の JS なので、**node で直に起こせば
 * 引数は配列のまま渡り、OS ごとの引用の話が消える。**pnpm を 1 つ挟まない分、速くもなる。
 */
export function desktopLaunch(
  args: readonly string[],
  fromDir = dirname(fileURLToPath(import.meta.url)),
): DesktopLaunch {
  // `packages/host/src` から見た画面のパッケージ。**`git-qa-ocr` を探す道と同じ数え方。**
  const cwd = resolve(fromDir, '..', '..', 'desktop');
  const cli = createRequire(join(cwd, 'package.json')).resolve('@tauri-apps/cli/tauri.js');

  return { command: process.execPath, args: [cli, ...args], cwd };
}

/** 画面を起こす。**閉じられるまでは、呼んだ側が見張る。** */
export function spawnDesktop(args: readonly string[]): ChildProcess {
  const launch = desktopLaunch(args);
  return spawn(launch.command, [...launch.args], { cwd: launch.cwd, stdio: 'inherit' });
}

/** Tauri の既定の開発サーバ。`packages/desktop/vite.config.ts` と揃えている。 */
const DEFAULT_DEV_URL = 'http://localhost:1420';

export interface TauriDevArgsOptions {
  readonly devUrl?: string;
  /** 打鍵を返す口。**実行を伴わない `pnpm live` では渡さない。** */
  readonly controlUrl?: string;
  /** 端末とシートを選ぶ口。**アプリを入口にするときに渡す**（Issue 011 段階 3）。 */
  readonly setupUrl?: string;
  /**
   * 流れてくる映像の種類。**画面側では決められない**ので渡す。
   * Android は H.264、ウェブはブラウザの画像 1 枚ずつ（C54）。
   */
  readonly liveKind?: 'h264' | 'images';
  /**
   * 何を相手にしているか。**画面が断りを出すかどうかを、これで決める。**
   * デスクトップだけ、なぞる・掴んで運ぶで指が一瞬飛ぶ（C57）。
   */
  readonly targetKind?: 'desktop';
}

/**
 * `tauri dev` へ渡す引数。
 *
 * **Tauri は devUrl を開く。**起動時の値を webview へ渡す口はここしか無いので、
 * 映像と制御の URL をクエリに載せる。生で埋めるとクエリが壊れるので `URL` に組ませる。
 */
export function tauriDevArgs(
  liveUrl: string | undefined,
  options: TauriDevArgsOptions = {},
): string[] {
  const target = new URL(options.devUrl ?? DEFAULT_DEV_URL);
  // 端末に繋ぐ前に画面を出す場合は、まだ映像の URL が無い。
  if (liveUrl !== undefined) target.searchParams.set('live', liveUrl);
  // 繋いでいないのに口があるように見せない。画面側は `?control=` の有無で振る舞いを変える。
  if (options.controlUrl !== undefined) target.searchParams.set('control', options.controlUrl);
  if (options.setupUrl !== undefined) target.searchParams.set('setup', options.setupUrl);
  // 既定は H.264（Android）。**知らせないと、画面はブラウザの絵を H.264 として復号しようとする。**
  if (options.liveKind === 'images') target.searchParams.set('livekind', 'images');
  if (options.targetKind !== undefined) target.searchParams.set('targetkind', options.targetKind);

  return ['dev', '--config', JSON.stringify({ build: { devUrl: target.toString() } })];
}
