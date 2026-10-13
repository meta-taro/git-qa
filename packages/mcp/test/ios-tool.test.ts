import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findIosTool } from '../src/ios-tool.js';

/**
 * **USB で映す道具は macOS でしか動かない**（2026-10-13・Windows の席で踏んだ）。
 * repo に入っているので Windows の clone にも在る。在るだけで返すと、口だけの形に切り替わらない。
 */
describe('findIosTool', () => {
  const withTool = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'git-qa-mcp-ios-'));
    await writeFile(join(dir, 'git-qa-ios'), '');
    return dir;
  };

  it('macOS なら、在る道具を返す', async () => {
    const dir = await withTool();
    expect(await findIosTool(dir, 'darwin', {})).toBe(join(dir, 'git-qa-ios'));
  });

  it('macOS 以外では、道具が在っても返さない', async () => {
    const dir = await withTool();
    expect(await findIosTool(dir, 'win32', {})).toBeUndefined();
  });

  it('場所を渡されたら、それを使う', async () => {
    expect(await findIosTool('/nowhere', 'win32', { GIT_QA_IOS: '/given' })).toBe('/given');
  });
});
