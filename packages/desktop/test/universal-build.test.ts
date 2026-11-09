import { readFileSync } from 'node:fs';
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
