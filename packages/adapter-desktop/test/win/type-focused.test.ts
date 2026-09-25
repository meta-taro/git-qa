import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWindowsDesktopAdapter } from '../../src/win/adapter.js';

/**
 * **欄を指さない「入力する」を、Windows でも通す**（meta-taro/git-qa#42）。
 *
 * 日付欄（`input type=date`）の年を 4 桁で止める、という検証は
 * **1 キーごとに走る制限**を見ている。`SetValue` は値を丸ごと置き換えるので
 * **その制限を通らない** —— 確かめたいものを迂回してしまう。
 * だから欄を指さない形は、**焦点のある欄へ 1 文字ずつ打つ**（macOS の `keystroke` と同じ意味）。
 *
 * 実物の道具（`git-qa-win`）は Windows でしか動かないので、ここでは
 * **呼ばれた引数を書き残すだけの偽物**を置き、何を頼んだかを見る。
 */

const WINDOW_LINE = [
  '4242',
  '100',
  'C:\\app\\md-business.exe',
  'md-business',
  '0',
  '0',
  '800',
  '600',
].join('\t');

const build = { source: 'md-business', label: 'test' };

let dir: string;
let log: string;
let toolPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'git-qa-win-fake-'));
  log = join(dir, 'calls.log');
  toolPath = join(dir, 'git-qa-win');
  // 1 回の呼び出しを 1 行（引数はタブ区切り。\x1f は Linux の sh（dash）の printf が解さない）で残す。`windows` にだけ窓を 1 つ返す。
  await writeFile(
    toolPath,
    [
      '#!/bin/sh',
      `printf '%s\\t' "$@" >> '${log}'`,
      `printf '\\n' >> '${log}'`,
      `if [ "$1" = windows ]; then printf '%s\\n' '${WINDOW_LINE}'; fi`,
      `if [ "$1" = text ]; then printf '年\\t10\\t20\\t30\\t12\\n'; fi`,
    ].join('\n'),
  );
  await chmod(toolPath, 0o755);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function calls(): Promise<string[][]> {
  const raw = await readFile(log, 'utf8').catch(() => '');
  return raw
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => l.split('\t').slice(0, -1));
}

describe.skipIf(process.platform === 'win32')('Windows の「入力する」', () => {
  it('欄を指さなければ、焦点のある欄へ 1 文字ずつ打つ（窓を添えて）', async () => {
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
    }).connect();

    await session.act({ kind: 'type', text: '20260903' });

    expect((await calls()).filter((c) => c[0] !== 'windows')).toEqual([
      ['keys', '4242', '20260903'],
    ]);
  });

  /** 欄を指す形は変えない（#9 で実測した `SetValue` のまま）。 */
  it('欄を指せば、今までどおりその欄の値を置き換える', async () => {
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
    }).connect();

    await session.act({ kind: 'type', text: 'abc', target: { at: 'element', ref: '年' } });

    const sent = (await calls()).filter((c) => c[0] !== 'windows' && c[0] !== 'text');
    expect(sent.map((c) => [c[0], c[1], c[4]])).toEqual([['type', '4242', 'abc']]);
  });
});
