import { describe, expect, it } from 'vitest';

import { listIosDevices } from '../src/adapter.js';

/**
 * **一覧が空なら、道具を起こし直す**（2026-10-07・実機で測った）。
 *
 * 前のプロセスが端末を手放した直後は、新しいプロセスから **10 秒以上**見えなくなる。
 * しかも、その最中に始まったプロセスは**待ち続けても見つけられない**（20 秒待っても 0 台）。
 * 実行器は一覧・繋ぐ・映すと続けて起こすので、**起こし直す**しかない。
 */
const LINE = '00008020-001325480284003A\tiPhone\tiOS Device\n';

describe('listIosDevices — 起こし直し', () => {
  it('空なら、間を置いて起こし直す', async () => {
    const said = ['', '', LINE];
    let calls = 0;
    const devices = await listIosDevices('git-qa-ios', {
      run: () => Promise.resolve(said[calls++] ?? ''),
      gapMs: 1,
      attempts: 5,
    });

    expect(calls).toBe(3);
    expect(devices.map((d) => d.id)).toEqual(['00008020-001325480284003A']);
  });

  it('最初から見えれば、1 回で返す', async () => {
    let calls = 0;
    await listIosDevices('git-qa-ios', {
      run: () => {
        calls += 1;
        return Promise.resolve(LINE);
      },
      gapMs: 1,
      attempts: 5,
    });

    expect(calls).toBe(1);
  });

  it('最後まで空なら、空を返す（呼ぶ側が「端末が無い」と言う）', async () => {
    let calls = 0;
    const devices = await listIosDevices('git-qa-ios', {
      run: () => {
        calls += 1;
        return Promise.resolve('');
      },
      gapMs: 1,
      attempts: 4,
    });

    expect(calls).toBe(4);
    expect(devices).toEqual([]);
  });
});
