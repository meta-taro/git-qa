import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { announceScreen, findScreens, screensDir } from '../src/screens.js';

/**
 * **開いている git-qa の画面を、MCP（別のプロセス）が見つける**（C120）。
 *
 * 入口サーバの口は起動ごとに違う番号なので、名乗りをファイルに置く。
 * 置き場所は作業ディレクトリでも試験の家でもない（証跡や commit に混ざらない所）。
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'git-qa-screens-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const record = (pid: number, startedAt = '2026-11-12T03:00:00.000Z') => ({
  url: `http://127.0.0.1:${String(40000 + pid)}/setup/abc`,
  pid,
  release: 'v0.2.1',
  startedAt,
});

describe('screensDir', () => {
  it('ホームの下の .git-qa/screens（作業ディレクトリに置かない）', () => {
    expect(screensDir('/home/qa')).toBe(join('/home/qa', '.git-qa', 'screens'));
  });
});

describe('announceScreen / findScreens', () => {
  it('名乗りを置くと見つかり、外すと見つからない', async () => {
    const remove = announceScreen(record(process.pid), dir);

    expect(await findScreens(dir, () => true)).toEqual([record(process.pid)]);

    remove();
    expect(await findScreens(dir, () => true)).toEqual([]);
  });

  it('死んだプロセスの名乗りは捨てる（残骸で「開いている」と言わない）', async () => {
    announceScreen(record(111), dir);
    announceScreen(record(222), dir);

    const found = await findScreens(dir, (pid) => pid === 222);

    expect(found.map((s) => s.pid)).toEqual([222]);
    // 捨てたものはファイルも消える。次に探すときに同じ判定を繰り返さない。
    expect(await readdir(dir)).toEqual(['222.json']);
  });

  it('新しいものが先（pnpm app と配布物が両方開いていたら、後から開いた方を先に）', async () => {
    announceScreen(record(1, '2026-11-12T03:00:00.000Z'), dir);
    announceScreen(record(2, '2026-11-12T04:00:00.000Z'), dir);

    expect((await findScreens(dir, () => true)).map((s) => s.pid)).toEqual([2, 1]);
  });

  it('読めないファイルは捨てる（壊れた 1 つで全部が見えなくならない）', async () => {
    announceScreen(record(1), dir);
    await writeFile(join(dir, 'broken.json'), '{not json', 'utf8');
    await writeFile(join(dir, '7.json'), JSON.stringify({ url: 1 }), 'utf8');

    expect((await findScreens(dir, () => true)).map((s) => s.pid)).toEqual([1]);
  });

  it('置き場所が無ければ空（まだ一度も開いていない機械）', async () => {
    expect(await findScreens(join(dir, 'nothing-here'), () => true)).toEqual([]);
  });

  it('名乗りの中身は URL・pid・版・開いた時刻だけ（人の名前やパスは入れない）', async () => {
    announceScreen(record(5), dir);

    const written = JSON.parse(await readFile(join(dir, '5.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(written).sort()).toEqual(['pid', 'release', 'startedAt', 'url']);
  });
});
