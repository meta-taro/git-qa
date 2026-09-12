/**
 * Windows で窓を見る道具（`git-qa-win.exe`）を建てて、配布物へ入れる。
 *
 * **Windows でしか建たない。**`windows` crate は Windows の口そのものなので、
 * macOS / Linux では型すら解決できない。
 *
 * **建てないことと、失敗することを分ける。**macOS で「建てられない」と出ると、
 * 直すべき何かがあるように読めてしまう。
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const crate = resolve(here, '..', '..', 'adapter-desktop', 'tools', 'win');
const out = resolve(here, '..', 'src-tauri', 'resources', 'git-qa-win.exe');

if (process.platform !== 'win32') {
  console.log('[git-qa] Windows 用の道具は Windows でだけ建てます（ここでは何もしません）');
  process.exit(0);
}

try {
  execFileSync('cargo', ['build', '--release', '--manifest-path', join(crate, 'Cargo.toml')], {
    stdio: 'inherit',
  });
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(crate, 'target', 'release', 'git-qa-win.exe'), out);
  console.log('[git-qa] git-qa-win.exe: 同梱しました');
} catch (error) {
  // **黙って進まない。**Windows でこれが無いと、デスクトップ検証が丸ごとできない。
  console.error('[git-qa] 窓を見る道具を建てられない:', error.message);
  process.exit(1);
}
