import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **mac の配布物は 1 本で Apple シリコンと Intel の両方に入る（universal）**（C115・2026-11-09）。
 *
 * 配り方は YAML と shell で、コードから型で守れない。**片方の CPU だけに戻っても誰も気づかない**
 * （Intel Mac の人が「壊れているため開けません」に当たって初めて分かる）ので、ここで縛る。
 */

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const release = read('../../../.github/workflows/release.yml');
const macJob = release.slice(release.indexOf('\n  macos:'), release.indexOf('\n  windows:'));
const pkg = JSON.parse(read('../package.json')) as { scripts: Record<string, string> };
const rustTool = read('../scripts/build-rust-tool.sh');

describe('mac の配布物は universal', () => {
  it('建てる前に、両方の CPU の Rust の的を入れる', () => {
    expect(macJob).toMatch(/rustup target add[^\n]*aarch64-apple-darwin/);
    expect(macJob).toMatch(/rustup target add[^\n]*x86_64-apple-darwin/);
  });

  it('tauri build は、署名あり・なしの両方とも universal を指す', () => {
    // 説明の文（コメント）ではなく、走らせる行（`run:`）だけを見る。
    const builds = macJob.match(/run:[^\n]*tauri build[^\n]*/g) ?? [];
    expect(builds.length).toBeGreaterThanOrEqual(2);
    for (const line of builds) expect(line).toContain('--target universal-apple-darwin');
  });

  it('検める・持ち出すのは universal の置き場所（片方の CPU の置き場所を見に行かない）', () => {
    expect(macJob).toContain('target/universal-apple-darwin/release/bundle/dmg');
    expect(macJob).not.toMatch(/target\/release\/bundle/);
  });

  it('中の .app そのものが両方の CPU を持つことを、配る前に確かめる', () => {
    // 同梱の道具だけ見て、本体を見ていない、を作らない。
    expect(macJob).toContain('Contents/MacOS');
    expect(macJob).toMatch(/lipo -info "\$main"/);
  });

  it('同梱の Rust の道具（git-qa-input）も両方の CPU で建てて 1 本にする', () => {
    expect(pkg.scripts['bundle:input']).toContain('build-rust-tool.sh');
    expect(pkg.scripts['bundle:input']).toContain('mac-only.mjs');
    expect(rustTool).toContain('aarch64-apple-darwin');
    expect(rustTool).toContain('x86_64-apple-darwin');
    expect(rustTool).toContain('lipo -create');
    // 建てた直後に署名する（まとめて後で署名すると建て直しで消える・sign-tool.sh の決まり）。
    expect(rustTool).toContain('sign-tool.sh');
  });

  it('配布ページは mac を Apple シリコンだけと言わない', () => {
    for (const page of ['../../../site/index.html', '../../../site/en/index.html']) {
      const html = read(page);
      expect(html).not.toMatch(/macOS（Apple Silicon）|macOS \(Apple Silicon\)/);
      expect(html).toMatch(/Intel/);
    }
  });
});

/**
 * **CI の初回で `git-qa-input` が建たず、配布物に入らないまま検査で止まった**（v0.2.0-beta.22・2026-11-10）。
 *
 * `cargo` の言い分を `target/<的>.err` へ書こうとしたが、**取ってきたばかりの clone に `target/` は無い。**
 * リダイレクトが先に失敗して cargo は 1 度も走らず、出たのは「No such file or directory」だけだった。
 * 手元では `target/` が既にあったので気づかなかった。**置き場所は自分で作る。**
 */
describe('build-rust-tool.sh — 取ってきたばかりの場所でも動く', () => {
  const script = fileURLToPath(new URL('../scripts/build-rust-tool.sh', import.meta.url));

  it('target/ が無くても cargo を呼び、建たなかった理由（cargo の言い分）を出す', () => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'git-qa-rust-tool-'));
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "fake"\n');
    // cargo の代役。**的が無いときの cargo と同じく、stderr へ理由を書いて 1 で返す。**
    const bin = join(dir, 'bin');
    spawnSync('mkdir', ['-p', bin]);
    writeFileSync(
      join(bin, 'cargo'),
      '#!/bin/sh\necho "error: the target may not be installed" >&2\nexit 1\n',
    );
    chmodSync(join(bin, 'cargo'), 0o755);

    const ran = spawnSync('bash', [script, join(dir, 'Cargo.toml'), 'fake', join(dir, 'out')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}` },
    });

    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain('the target may not be installed');
    expect(ran.stdout + ran.stderr).not.toContain('No such file or directory');
    expect(existsSync(join(dir, 'target'))).toBe(true);
  });
});
