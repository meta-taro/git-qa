import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { browserCandidates, FIREFOX_CANDIDATES } from '@git-qa/adapter-web';

import type { Probe, ProbeResult } from './doctor.js';
import { parseIosDevices } from './doctor.js';
import { findInput, findOcr, findRecord, findWinTool } from './ocr-path.js';

/**
 * **実際に呼んで、返ってきたものを出す**（C56・見込みを書かない）。
 *
 * ここは外の道具に触るので、**単体試験の対象にしない。**
 * 形（並べ方・判定）は `doctor.ts` にあり、そちらは試験してある。
 */

const run = promisify(execFile);

/** **落とさない。**無いことも答えなので、理由を文字にして返す。 */
const ask = async (command: string, args: readonly string[]): Promise<string | undefined> => {
  try {
    const { stdout } = await run(command, [...args], { timeout: 15_000 });
    return stdout;
  } catch {
    return undefined;
  }
};

const there = async (path: string | undefined): Promise<boolean> => {
  if (path === undefined) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const nodeVersion = (): ProbeResult => {
  const [major] = process.versions.node.split('.');
  const ok = Number(major) >= 22;
  return {
    name: 'Node',
    state: ok ? 'ok' : 'missing',
    detail: ok ? `v${process.versions.node}` : `v${process.versions.node}（22 以上が要ります）`,
  };
};

const android = async (): Promise<ProbeResult> => {
  const said = await ask('adb', ['devices']);
  if (said === undefined) {
    return {
      name: 'adb（Android）',
      state: 'missing',
      detail: '入っていない（Android を見ないなら要りません）',
    };
  }
  const devices = said
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('*'));
  return {
    name: 'adb（Android）',
    state: 'ok',
    detail:
      devices.length === 0
        ? '入っている（端末は 0 台）'
        : `${String(devices.length)} 台つながっている`,
  };
};

const browsers = async (): Promise<ProbeResult> => {
  const found: string[] = [];
  for (const path of browserCandidates()) {
    if (await there(path)) found.push(path.split(/[\\/]/).pop() ?? path);
  }
  const unique = [...new Set(found)];
  return {
    name: 'ブラウザ',
    state: unique.length === 0 ? 'missing' : 'ok',
    detail: unique.length === 0 ? '1 つも見つからない' : unique.join(' / '),
  };
};

/**
 * **iPhone はまだ相手にできない**（README の表・`.claude/issues/001`）。
 * それでも**挿したことには気づく。**
 */
const iphone = async (): Promise<ProbeResult> => {
  if (process.platform !== 'darwin') {
    return {
      name: 'iPhone',
      state: 'missing',
      detail: 'この OS では見に行きません（Windows から iOS は未測定・issues/001）',
    };
  }
  const said = await ask('xcrun', ['devicectl', 'list', 'devices']);
  if (said === undefined) {
    return { name: 'iPhone', state: 'missing', detail: 'Xcode の道具が無いので数えられない' };
  }
  const devices = parseIosDevices(said);
  return {
    name: 'iPhone',
    state: 'ok',
    detail:
      devices.length === 0
        ? '実機はつながっていない（アダプタもまだ無い）'
        : `${devices.join(' / ')}（つながっているが、アダプタはまだ無い）`,
  };
};

/**
 * 建てた道具が在るか。
 *
 * **その OS で建たないものは `skip`**（2026-09-19）。macOS で `git-qa-win` が無いのは
 * 当たり前なのに、**健全な機械が「欠けています」と出ていた。**
 */
const tool =
  (
    name: string,
    find: () => Promise<string | undefined>,
    why: string,
    onlyOn?: readonly string[],
  ): (() => Promise<ProbeResult>) =>
  async () => {
    if (onlyOn !== undefined && !onlyOn.includes(process.platform)) {
      return { name, state: 'skip', detail: `この OS では要りません（${why}）` };
    }
    const path = await find();
    return {
      name,
      state: (await there(path)) ? 'ok' : 'missing',
      detail: (await there(path)) ? '在る' : `建てていない（${why}）`,
    };
  };

/** Firefox / Safari は別の道（WebDriver）なので、別に数える。 */
const otherBrowsers = async (): Promise<ProbeResult> => {
  const found: string[] = [];
  for (const path of FIREFOX_CANDIDATES) {
    if (await there(path)) {
      found.push('Firefox');
      break;
    }
  }
  // \*\*`--help` は 1 で返る\*\*（2026-09-19 実測）。`--version` を聞く。
  const safari =
    process.platform === 'darwin' ? await ask('safaridriver', ['--version']) : undefined;
  if (safari !== undefined) found.push(safari.trim().split('\n')[0] ?? 'Safari');
  return {
    name: 'Firefox / Safari',
    state: found.length === 0 ? 'missing' : 'ok',
    detail:
      found.length === 0
        ? '見つからない（Chromium 系だけで見るなら要りません）'
        : found.join(' / '),
  };
};

const optional =
  (name: string, command: string, why: string): (() => Promise<ProbeResult>) =>
  async () => {
    const said = await ask(command, ['-version']);
    return {
      name,
      state: said === undefined ? 'missing' : 'ok',
      detail: said === undefined ? `入っていない（${why}）` : '在る',
    };
  };

/** この機械を測る一式。**柱ごとに分けてある。** */
export const PROBES: readonly Probe[] = [
  { pillar: '見る', run: () => Promise.resolve(nodeVersion()) },
  { pillar: '見る', run: android },
  { pillar: '見る', run: browsers },
  { pillar: '見る', run: otherBrowsers },
  { pillar: '見る', run: iphone },
  {
    pillar: '読む',
    run: tool('git-qa-ocr', findOcr, 'pnpm build で建ちます。Electron 相手に要ります'),
  },
  {
    pillar: '押す',
    run: tool('git-qa-input', findInput, 'pnpm build で建ちます。無いと押すたび相手が前面に出ます'),
  },
  {
    pillar: '押す',
    run: tool('git-qa-win（Windows のデスクトップ）', findWinTool, 'Windows でだけ建ちます', [
      'win32',
    ]),
  },
  {
    pillar: '残す',
    run: tool('git-qa-record（録画）', findRecord, 'macOS でだけ建ちます', ['darwin']),
  },
  {
    pillar: '残す',
    run: optional('ffmpeg', 'ffmpeg', '無くても動きます。動画が変換されずに残ります'),
  },
];
