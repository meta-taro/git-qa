import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * **開発の起動の前に、配布物に入れるものを揃える**（2026-10-06・ARM の Windows で踏んだ）。
 *
 * `tauri dev` も、設定に載っている入れるもの（`resources/…`）が在るかを建てる時に確かめる。
 * それらは git に入っておらず `pnpm build` の中でしか作られないので、**まっさらな clone で
 * `pnpm app` を走らせると `resources\\git-qa-win.exe doesn't exist` で止まっていた。**
 *
 * 試験では置き場所を差し替え、**何を走らせるか**だけを出させる（`--dry-run`）。
 */
const SCRIPT = fileURLToPath(new URL('../scripts/ensure-resources.mjs', import.meta.url));

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const fixture = (resources: string[], present: string[]): string => {
  dir = mkdtempSync(join(tmpdir(), 'git-qa-ensure-'));
  writeFileSync(join(dir, 'tauri.windows.conf.json'), JSON.stringify({ bundle: { resources } }));
  mkdirSync(join(dir, 'resources'));
  for (const one of present) writeFileSync(join(dir, one), '');
  return dir;
};

const run = (at: string): string =>
  execFileSync(process.execPath, [SCRIPT, '--dry-run'], {
    env: { ...process.env, GIT_QA_TAURI_DIR: at, GIT_QA_PLATFORM: 'win32' },
    encoding: 'utf8',
  });

describe('ensure-resources', () => {
  it('入れるものが 1 つでも無ければ、bundle:host を走らせる', () => {
    const at = fixture(
      ['resources/host-bundle.mjs', 'resources/git-qa-win.exe'],
      ['resources/host-bundle.mjs'],
    );

    const said = run(at);

    expect(said).toContain('resources/git-qa-win.exe');
    expect(said).toContain('pnpm bundle:host');
  });

  it('全部揃っていれば、何も建てない（起動のたびに待たせない）', () => {
    const at = fixture(['resources/host-bundle.mjs'], ['resources/host-bundle.mjs']);

    expect(run(at)).not.toContain('pnpm bundle:host');
  });

  it('その OS の設定が無ければ、共通の設定だけを見る', () => {
    dir = mkdtempSync(join(tmpdir(), 'git-qa-ensure-'));
    writeFileSync(
      join(dir, 'tauri.conf.json'),
      JSON.stringify({ bundle: { resources: ['resources/host-bundle.mjs'] } }),
    );

    expect(run(dir)).toContain('pnpm bundle:host');
  });
});
