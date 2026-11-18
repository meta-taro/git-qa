import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeAdapter } from '@git-qa/core';

import {
  claimDevice,
  claimingAdapter,
  deviceClaimsDir,
  deviceKey,
  heldByReason,
} from '../src/device-claims.js';

/**
 * **同じ機械の別の席が同じ端末を掴んでいれば、名乗りで先に断る**（C121 の 3 つ目）。
 *
 * 2026-11-12、別の席が使っている iPhone を git-qa が触って作業を邪魔した。
 * 前面の見張り（1・2）は触ってから気づく守り。こちらは**触る前に、同じ機械の中で分かる分だけ断る**。
 * 置き場所は画面の名乗り（`~/.git-qa/screens`）と同じ考え：ホームの下・pid が生きていなければ捨てる。
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'git-qa-devices-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const claim = (pid: number, startedAt = '2026-11-18T04:00:00.000Z') => ({
  device: 'ios:00008140-ABCDEF',
  pid,
  release: 'v0.2.1',
  seat: '検証の実行（買い物メモ）',
  startedAt,
});

describe('deviceClaimsDir / deviceKey', () => {
  it('ホームの下の .git-qa/devices（作業ディレクトリに置かない）', () => {
    expect(deviceClaimsDir('/home/qa')).toBe(join('/home/qa', '.git-qa', 'devices'));
  });

  it('端末の鍵は種類と識別子。識別子を省けば「最初に見つかるもの」として 1 つに寄せる', () => {
    expect(deviceKey('ios', '00008140-ABCDEF')).toBe('ios:00008140-ABCDEF');
    expect(deviceKey('android', undefined)).toBe('android:(default)');
  });
});

describe('claimDevice — 掴む・断る・外す', () => {
  it('誰も掴んでいなければ掴め、外すとファイルが消える', async () => {
    const result = claimDevice(claim(process.pid), dir, () => true);
    expect(result.ok).toBe(true);
    expect(await readdir(dir)).toHaveLength(1);

    if (result.ok) result.release();
    expect(await readdir(dir)).toEqual([]);
  });

  it('生きている別の席が掴んでいれば断り、その名乗りを返す', () => {
    const first = claimDevice(claim(4242), dir, () => true);
    expect(first.ok).toBe(true);

    const second = claimDevice(claim(process.pid), dir, () => true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.holder).toEqual(claim(4242));
  });

  it('掴んでいた席が死んでいれば、名乗りを捨てて掴める', async () => {
    claimDevice(claim(4242), dir, () => true);

    const result = claimDevice(claim(process.pid), dir, (pid) => pid !== 4242);
    expect(result.ok).toBe(true);
    expect(await readdir(dir)).toHaveLength(1);
  });

  it('自分の pid の名乗りなら、掴み直せる（同じ席の二度目）', () => {
    claimDevice(claim(process.pid), dir, () => true);
    expect(claimDevice(claim(process.pid), dir, () => true).ok).toBe(true);
  });

  it('読めない名乗りは捨てて掴める', async () => {
    await writeFile(join(dir, 'ios_00008140-ABCDEF.json'), '{ こわれている');
    expect(claimDevice(claim(process.pid), dir, () => true).ok).toBe(true);
  });

  it('別の端末の名乗りは邪魔にならない', () => {
    claimDevice({ ...claim(4242), device: 'android:emulator-5554' }, dir, () => true);
    expect(claimDevice(claim(process.pid), dir, () => true).ok).toBe(true);
  });
});

describe('heldByReason — 人に見せる断りの文', () => {
  it('どの席が・いつから・どの端末を使っているかを言い、何をすればよいかで終わる', () => {
    const reason = heldByReason(claim(4242, '2026-11-18T04:05:00.000Z'));
    expect(reason).toContain('いま、この機械の別の席');
    expect(reason).toContain('検証の実行（買い物メモ）');
    expect(reason).toContain('pid 4242');
    expect(reason).toContain('ios:00008140-ABCDEF');
    expect(reason).toContain('使っています');
    expect(reason).toMatch(/もう一度/);
  });
});

describe('claimingAdapter — 繋ぐ前に掴み、閉じるときに外す', () => {
  const options = (seat = 'MCP の席') => ({
    device: 'ios:00008140-ABCDEF',
    seat,
    release: 'v0.2.1',
    dir,
    isAlive: () => true,
  });

  it('空いていれば繋ぎ、閉じると名乗りが外れる', async () => {
    const adapter = claimingAdapter(createFakeAdapter({ kind: 'ios' }), options());
    const session = await adapter.connect();
    expect(await readdir(dir)).toHaveLength(1);
    expect(session.isClosed).toBe(false);

    await session.close();
    expect(session.isClosed).toBe(true);
    expect(await readdir(dir)).toEqual([]);
  });

  it('別の席が掴んでいれば、相手に触る前に理由を言って断る', async () => {
    claimDevice({ ...claim(4242), seat: '検証の実行（買い物メモ）' }, dir, () => true);
    let connected = 0;
    const inner = createFakeAdapter({ kind: 'ios' });
    const counting = {
      ...inner,
      connect: () => {
        connected += 1;
        return inner.connect();
      },
    };

    const adapter = claimingAdapter(counting, options());
    await expect(adapter.connect()).rejects.toThrow(/別の席.*検証の実行（買い物メモ）/);
    expect(connected).toBe(0);
  });

  it('繋ぐのに失敗したら、掴んだ名乗りを外す（掴んだまま居なくならない）', async () => {
    const inner = createFakeAdapter({ kind: 'ios' });
    const failing = {
      ...inner,
      connect: () => Promise.reject(new Error('端末が見えない')),
    };

    const adapter = claimingAdapter(failing, options());
    await expect(adapter.connect()).rejects.toThrow('端末が見えない');
    expect(await readdir(dir)).toEqual([]);
  });

  it('種類と口はそのまま（包んでも名乗りは変えない）', () => {
    const inner = createFakeAdapter({ kind: 'android' });
    const adapter = claimingAdapter(inner, options());
    expect(adapter.kind).toBe('android');
    expect(adapter.capabilities).toBe(inner.capabilities);
  });

  it('包んだセッションの口は中身へ通る（前面の見張りの口も）', async () => {
    const adapter = claimingAdapter(createFakeAdapter({ kind: 'ios' }), options());
    const session = await adapter.connect();
    expect((await session.screenshot()).bytes.length).toBeGreaterThan(0);
    // 見本の相手は前面を言えない。**無いものは無いまま**（空の口を生やさない）。
    expect('foreground' in session).toBe(false);
    await session.close();
  });
});
