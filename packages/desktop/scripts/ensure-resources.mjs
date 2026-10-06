/**
 * **開発の起動の前に、配布物に入れるものを揃える**（2026-10-06・ARM の Windows で踏んだ）。
 *
 * `tauri dev` も、設定に載っている入れるもの（`resources/…`）が在るかを建てる時に確かめる。
 * それらは git に入っておらず `pnpm build`（`bundle:host`）の中でしか作られないので、
 * **まっさらな clone で `pnpm app` を走らせると、Windows では `git-qa-win.exe` が無いと言って止まった。**
 *
 * **無いものがあるときだけ** `bundle:host` を走らせる（各 OS の道具まで続けて建てる）。
 * 揃っていれば何もしない —— 起動のたびに建て直して待たせない。
 *
 * `--dry-run` で、走らせずに何をするかだけを出す（試験用）。
 * `GIT_QA_TAURI_DIR` / `GIT_QA_PLATFORM` で、見る所と OS を差し替えられる（試験用）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = process.env.GIT_QA_TAURI_DIR ?? resolve(here, '..', 'src-tauri');
const platform = process.env.GIT_QA_PLATFORM ?? process.platform;
const dryRun = process.argv.includes('--dry-run');

/** Tauri の決まり: OS ごとの設定は `tauri.<windows|macos|linux>.conf.json`。配列は上書きされる。 */
const NAMES = { win32: 'windows', darwin: 'macos', linux: 'linux' };

const read = (name) => {
  const path = join(tauriDir, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
};

const own = NAMES[platform] === undefined ? undefined : read(`tauri.${NAMES[platform]}.conf.json`);
const resources = own?.bundle?.resources ?? read('tauri.conf.json')?.bundle?.resources ?? [];
const missing = resources.filter((one) => !existsSync(join(tauriDir, one)));

if (missing.length === 0) {
  console.log('[git-qa] 配布物に入れるものは揃っている');
  process.exit(0);
}

console.log(`[git-qa] 配布物に入れるものが足りない: ${missing.join(' / ')}`);
console.log('[git-qa] pnpm bundle:host で建てる（初回だけ時間がかかります）');
if (dryRun) process.exit(0);

execFileSync('pnpm', ['bundle:host'], {
  cwd: resolve(tauriDir, '..'),
  stdio: 'inherit',
  // Windows では pnpm は .cmd なので、殻を通さないと起こせない。
  shell: process.platform === 'win32',
});
