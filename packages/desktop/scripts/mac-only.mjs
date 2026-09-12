/**
 * macOS でだけ走らせる（2026-09-12・Windows 機で実測して足した）。
 *
 * `build-swift-tool.sh` は、建てられない環境では何もせず 0 で返るように書いてある。
 * **ところが Windows では、その中身まで届かない。**
 *
 * ```text
 * $ bash scripts/build-swift-tool.sh ...
 * <3>WSL (9 - Relay) ERROR: CreateProcessCommon:818: execvpe(/bin/bash) failed: No such file or directory
 * [ELIFECYCLE] Command failed with exit code 1.
 * ```
 *
 * Windows の `bash` は、**どの殻から走らせたかで別物になる。**PowerShell から
 * 呼ぶと `System32\bash.exe`（WSL）に当たり、WSL に中身が無ければそこで落ちる。
 * Git Bash から呼べば通る。**同じ commit が、開いている窓によって通ったり落ちたりする。**
 *
 * だから `bash` を呼ぶ手前で止める。**判断を殻に任せない。**
 * `bundle-win.mjs` が Windows 以外で何もしないのと、同じ形。
 */
import { spawnSync } from 'node:child_process';

const [command, ...args] = process.argv.slice(2);

if (command === undefined) {
  console.error('[git-qa] 使い方: node scripts/mac-only.mjs <コマンド> [引数...]');
  process.exit(2);
}

if (process.platform !== 'darwin') {
  console.log(`[git-qa] ${command} は macOS でだけ走らせます（ここでは何もしません）`);
  process.exit(0);
}

const done = spawnSync(command, args, { stdio: 'inherit' });

// **起こせなかったことを、成功にしない。**
if (done.error !== undefined) {
  console.error(`[git-qa] ${command} を起こせない: ${done.error.message}`);
  process.exit(1);
}
process.exit(done.status ?? 1);
