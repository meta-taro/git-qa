import { describe, expect, it, vi } from 'vitest';

import {
  assertDesktopPortFree,
  desktopLaunch,
  runWithLiveView,
  tauriDevArgs,
} from '../src/index.js';
import { stubAdapter } from './stub-adapter.js';

describe('tauriDevArgs', () => {
  it('画面が読む URL を、devUrl のクエリに載せる', () => {
    // Tauri は devUrl を開く。ここに載せる以外に、起動時の値を webview へ渡す手が無い。
    const args = tauriDevArgs('http://127.0.0.1:9000/live/abc.h264');
    const config: unknown = JSON.parse(args[args.indexOf('--config') + 1] ?? '');

    expect(args.slice(0, 2)).toEqual(['dev', '--config']);
    expect(config).toMatchObject({
      build: { devUrl: expect.stringContaining('http://localhost:1420/?live=') as unknown },
    });
  });

  it('URL をそのまま埋めず、クエリとして安全な形にする', () => {
    // 橋の URL には : / が入る。生で埋めるとクエリが壊れる。
    const live = 'http://127.0.0.1:9000/live/abc.h264';
    const args = tauriDevArgs(live);
    const config = JSON.parse(args[args.indexOf('--config') + 1] ?? '') as {
      build: { devUrl: string };
    };

    const parsed = new URL(config.build.devUrl);
    expect(parsed.searchParams.get('live')).toBe(live);
  });

  it('打鍵を返す口も、同じクエリに載せる', () => {
    // 映像だけ渡しても、人が置いた判定を返す先が無い。**画面は 2 本の線で成り立つ。**
    const control = 'http://127.0.0.1:9000/live/abc/control';
    const args = tauriDevArgs('http://127.0.0.1:9000/live/abc.h264', { controlUrl: control });
    const config = JSON.parse(args[args.indexOf('--config') + 1] ?? '') as {
      build: { devUrl: string };
    };

    expect(new URL(config.build.devUrl).searchParams.get('control')).toBe(control);
  });

  it('打鍵を返す口が無ければ、クエリにも載せない（繋いでいないのに口があるように見せない）', () => {
    const args = tauriDevArgs('http://127.0.0.1:9000/live/abc.h264');
    const config = JSON.parse(args[args.indexOf('--config') + 1] ?? '') as {
      build: { devUrl: string };
    };

    expect(new URL(config.build.devUrl).searchParams.has('control')).toBe(false);
  });

  it('devUrl を差し替えられる', () => {
    const args = tauriDevArgs('http://127.0.0.1:1/live/a.h264', {
      devUrl: 'http://localhost:5173',
    });
    const config = JSON.parse(args[args.indexOf('--config') + 1] ?? '') as {
      build: { devUrl: string };
    };

    expect(config.build.devUrl.startsWith('http://localhost:5173/?live=')).toBe(true);
  });

  it('JSON として読める形で渡す', () => {
    // 壊れた JSON を渡すと tauri が黙って既定値で起動し、映像の無い画面が出る。
    const args = tauriDevArgs('http://127.0.0.1:1/live/a.h264');
    const raw = args[args.indexOf('--config') + 1] ?? '';
    expect(() => {
      JSON.parse(raw);
    }).not.toThrow();
  });
});

describe('runWithLiveView', () => {
  it('画面へ、橋の URL を渡す', async () => {
    const adapter = stubAdapter({});
    const launch = vi.fn().mockResolvedValue(undefined);

    await runWithLiveView({ adapter, launch });

    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0]?.[0]).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/live\/[0-9a-f]{32}\.h264$/,
    );
  });

  it('画面を起こす時点で、その URL から映像が読める', async () => {
    // 順番を間違えて先に画面を起こすと、繋がらない URL を渡すことになる。
    const adapter = stubAdapter({});
    let readable = false;

    await runWithLiveView({
      adapter,
      launch: async (url) => {
        readable = (await fetch(url)).ok;
      },
    });

    expect(readable).toBe(true);
  });

  it('画面が閉じたら、ライブビューとセッションを閉じる', async () => {
    // 人が窓を閉じたのに端末を掴んだままにしない。
    const adapter = stubAdapter({});

    await runWithLiveView({ adapter, launch: () => Promise.resolve() });

    expect(adapter.closed).toEqual(['liveView', 'session']);
  });

  it('画面が落ちても、閉じてから投げる', async () => {
    const adapter = stubAdapter({});

    await expect(
      runWithLiveView({ adapter, launch: () => Promise.reject(new Error('画面が落ちた')) }),
    ).rejects.toThrow(/画面が落ちた/);

    expect(adapter.closed).toEqual(['liveView', 'session']);
  });

  it('端末に繋げなければ、画面を起こさない', async () => {
    // 映らない画面を出すと、繋がっていないのか映らないのかが人に分からない。
    const adapter = stubAdapter({ mode: 'external-window' });
    const launch = vi.fn().mockResolvedValue(undefined);

    await expect(runWithLiveView({ adapter, launch })).rejects.toThrow(/映像を読む口/);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe('tauriDevArgs — アプリを入口にする（Issue 011 段階 3）', () => {
  const config = (args: string[]): { build: { devUrl: string } } =>
    JSON.parse(args[args.indexOf('--config') + 1] ?? '') as { build: { devUrl: string } };

  it('端末に繋ぐ前でも画面を出せる（映像の URL がまだ無い）', () => {
    const args = tauriDevArgs(undefined, { setupUrl: 'http://127.0.0.1:7/setup/abc' });
    const url = new URL(config(args).build.devUrl);

    expect(url.searchParams.get('setup')).toBe('http://127.0.0.1:7/setup/abc');
    expect(url.searchParams.has('live')).toBe(false);
  });
});

/**
 * **画面の起こし方**（2026-09-12・Windows 機で実測して足した）。
 *
 * それまでは `spawn('pnpm', ['--filter', …, 'exec', 'tauri', …])` だった。
 * **Windows では 1 度も起きない。**
 *
 * ```text
 * Error: spawn pnpm ENOENT
 *   spawnargs: [ '--filter', '@git-qa/desktop', 'exec', 'tauri', 'dev', '--config', '{"build":…}' ]
 * ```
 *
 * Windows の `pnpm` は `pnpm.cmd` で、Node は拡張子を補わない。
 * **shell を噛ませて直すのは採らない** —— `--config` に渡す JSON には `"` が入っていて、
 * cmd.exe の引用で壊れる。Tauri の CLI は素の JS なので、**node で直に起こせば
 * 引数は配列のまま渡り、OS ごとの引用の話が消える。**
 */
describe('desktopLaunch', () => {
  it('いま走っている node で起こす（pnpm を探しに行かない）', () => {
    expect(desktopLaunch(['dev']).command).toBe(process.execPath);
  });

  /** **pnpm を経由しない。**経由しないことが、この関数の要点。 */
  it('起こすのは Tauri の CLI そのもの', () => {
    const launch = desktopLaunch(['dev']);

    expect(launch.args[0]).toMatch(/tauri\.js$/);
    expect(launch.args).not.toContain('--filter');
  });

  /**
   * **渡した引数は、そのままの形で後ろに付く。**
   * `--config` の JSON を、途中で文字列に潰さない（潰すと引用で壊れる）。
   */
  it('渡した引数を、形を変えずに後ろへ付ける', () => {
    const args = tauriDevArgs('http://127.0.0.1:9000/live/abc.h264');

    expect(desktopLaunch(args).args.slice(1)).toEqual(args);
  });

  /** Tauri は `tauri.conf.json` のある所から走る。**どこから呼んでも同じ場所を見る。** */
  it('画面のパッケージで走らせる', () => {
    expect(desktopLaunch(['dev']).cwd).toMatch(/desktop$/);
  });

  /**
   * **「画面の CLI が見つからない」側は、ここでは検査できない**（2026-09-12・実測）。
   *
   * vitest は Vite の解決を通すので、**でたらめなパスを渡しても**
   * `@tauri-apps/cli` が手元の node_modules から解決されてしまう。
   *
   * ```text
   * desktopLaunch(['dev'], 'C:\どこでもない\packages\host\src')
   *   → args[0] = C:\claude\git-qa\node_modules\…\tauri.js（解決されてしまう）
   * ```
   *
   * **正しい理由で落ちないテストは、負債にしかならない**ので置かない。
   * 断り方は `app.ts` 側にコメントで残してある。
   */
});

/**
 * **画面を起こす前に、口が空いているかを見る**（外部レビュー meta-taro/git-qa#7）。
 *
 * 掴まれたまま起こすと、vite の「Port 1420 is already in use」で死ぬ。
 * **その文言からは、掴んでいるのが誰か分からない。**
 */
describe('assertDesktopPortFree', () => {
  it('空いていれば、何も言わずに通す', async () => {
    await expect(
      assertDesktopPortFree({
        busy: () => Promise.resolve(false),
        explain: () => Promise.resolve(''),
      }),
    ).resolves.toBeUndefined();
  });

  it('掴まれていれば、誰が掴んでいるかごと止める', async () => {
    await expect(
      assertDesktopPortFree({
        busy: () => Promise.resolve(true),
        explain: () => Promise.resolve('掴んでいるのは 72394'),
      }),
    ).rejects.toThrow('72394');
  });
});
