import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findWinTool, winToolCandidates } from '../../src/win/find.js';

const AT = join('/', 'opt', 'git-qa', 'host');

/**
 * Windows で窓を見る道具（`git-qa-win.exe`）を探す。
 *
 * **探し方は 1 か所。**画面から始める道と MCP の道で別々に持っていたら、
 * MCP の道には無く、Windows では MCP からデスクトップを見られなかった（2026-11-05 の報告）。
 */
describe('winToolCandidates', () => {
  it('配布物の隣を先に見る', () => {
    expect(winToolCandidates(AT)[0]).toBe(join(AT, 'git-qa-win.exe'));
  });

  it('手元で建てたときの置き場所も見る（host からでも mcp からでも同じ所）', () => {
    const built = join('adapter-desktop', 'tools', 'win', 'target', 'release', 'git-qa-win.exe');
    for (const from of ['/repo/packages/host/src', '/repo/packages/mcp/src']) {
      expect(winToolCandidates(from).some((p) => p.endsWith(built))).toBe(true);
    }
  });

  it('同じ場所は 1 度だけ', () => {
    const paths = winToolCandidates(AT);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('findWinTool', () => {
  it('GIT_QA_WIN が渡されていれば、探さずにそれを使う', async () => {
    const asked: string[] = [];
    const found = await findWinTool(AT, { GIT_QA_WIN: 'C:\\tools\\git-qa-win.exe' }, (p) => {
      asked.push(p);
      return Promise.resolve(false);
    });
    expect(found).toBe('C:\\tools\\git-qa-win.exe');
    expect(asked).toEqual([]);
  });

  it('候補を順に見て、在る最初のものを返す', async () => {
    const there = winToolCandidates(AT)[1] as string;
    const found = await findWinTool(AT, {}, (p) => Promise.resolve(p === there));
    expect(found).toBe(there);
  });

  it('どこにも無ければ undefined（macOS では無いのが普通）', async () => {
    expect(await findWinTool(AT, {}, () => Promise.resolve(false))).toBeUndefined();
  });
});
