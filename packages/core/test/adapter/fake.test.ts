import { describe, expect, it } from 'vitest';

import { createFakeAdapter } from '../../src/index.js';
import { describeAdapterContract } from '../../src/testing/index.js';

describeAdapterContract('Fake', () => createFakeAdapter());

describe('Fake アダプタ', () => {
  it('受けた操作を順番どおりに覚えている', async () => {
    // 「AI が何を触ったか」が後から読めないと、AUTO_PASS の中身が検証できない。
    const adapter = createFakeAdapter();
    const session = await adapter.connect();
    await session.act({ kind: 'tap', target: { at: 'element', ref: 'save-button' } });
    await session.act({ kind: 'type', text: 'メモ本文' });
    await session.act({ kind: 'key', key: 'Enter' });
    await session.close();

    expect(adapter.actions).toEqual([
      { kind: 'tap', target: { at: 'element', ref: 'save-button' } },
      { kind: 'type', text: 'メモ本文' },
      { kind: 'key', key: 'Enter' },
    ]);
  });

  it('画面の状態は、渡した生データがそのまま返る（コアが解釈しない）', async () => {
    // 対象ごとに形の違う状態を共通の型へ潰すと、潰した時点で情報が落ちる。
    const raw = { node: 'FrameLayout', children: [{ text: 'メモ一覧' }] };
    const adapter = createFakeAdapter({ observation: raw });
    const session = await adapter.connect();
    const observation = await session.observe();
    expect(observation.raw).toBe(raw);
    await session.close();
  });

  it('録画を頼まなければ not_requested になり、動画のファイル名を持たない', async () => {
    const adapter = createFakeAdapter({ recording: { requested: false } });
    const session = await adapter.connect();
    await session.recording.start(1);
    expect(await session.recording.stop()).toEqual({ state: 'not_requested' });
    await session.close();
  });

  it('録画を頼めば recorded になり、動画と長さが残る', async () => {
    const adapter = createFakeAdapter({ recording: { requested: true } });
    const session = await adapter.connect();
    await session.recording.start(3);
    const recording = await session.recording.stop();
    expect(recording.state).toBe('recorded');
    if (recording.state !== 'recorded') throw new Error('unreachable');
    expect(recording.file).toContain('003');
    expect(recording.durationMs).toBeGreaterThanOrEqual(0);
    await session.close();
  });

  it('録画に失敗したら failed になり、理由が残る（録画オフと区別できる・C20）', async () => {
    const adapter = createFakeAdapter({
      recording: { requested: true, failWith: '録画プロセスが途中で落ちた' },
    });
    const session = await adapter.connect();
    await session.recording.start(1);
    const recording = await session.recording.stop();
    expect(recording).toEqual({ state: 'failed', reason: '録画プロセスが途中で落ちた' });
    await session.close();
  });

  it('録画に対応しないアダプタは unsupported を理由付きで返す', async () => {
    // 「頼んだのに無い」を黙って not_requested にすると、後から嘘になる。
    const adapter = createFakeAdapter({
      capabilities: { recording: false },
      recording: { requested: true },
    });
    const session = await adapter.connect();
    await session.recording.start(1);
    const recording = await session.recording.stop();
    expect(recording.state).toBe('unsupported');
    if (recording.state !== 'unsupported') throw new Error('unreachable');
    expect(recording.reason).not.toBe('');
    await session.close();
  });

  it('始めていない録画を止めても落ちない', async () => {
    const adapter = createFakeAdapter({ recording: { requested: true } });
    const session = await adapter.connect();
    expect(await session.recording.stop()).toEqual({ state: 'not_requested' });
    await session.close();
  });

  it('閉じた後は観察もスクリーンショットもできない', async () => {
    const adapter = createFakeAdapter();
    const session = await adapter.connect();
    await session.close();
    await expect(session.observe()).rejects.toThrow(/閉じ/);
    await expect(session.screenshot()).rejects.toThrow(/閉じ/);
  });

  it('閉じるとライブビューも閉じる', async () => {
    const adapter = createFakeAdapter();
    const session = await adapter.connect();
    await session.liveView.open();
    await session.close();
    expect(session.liveView.isOpen).toBe(false);
  });

  it('どの対象の種類でも作れる', async () => {
    for (const kind of ['web', 'android', 'desktop'] as const) {
      const adapter = createFakeAdapter({ kind });
      const session = await adapter.connect();
      expect(session.target.kind).toBe(kind);
      await session.close();
    }
  });
});
