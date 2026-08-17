import { describe, expect, it } from 'vitest';

import { type TargetAdapter, validateRun } from '../../src/index.js';
import { validRun } from '../run/fixtures.js';

/**
 * Adapter が満たすべき約束。**実装ごとにこの束を当てる。**
 *
 * Android を作るとき・Web を足すとき（Phase 5）に、ここが通ることが答え合わせになる。
 * 通らない実装が出たら、境界の引き方が間違っていたということ（Issue 002 の注意書き）。
 */
export function describeAdapterContract(name: string, makeAdapter: () => TargetAdapter): void {
  describe(`Adapter の約束: ${name}`, () => {
    it('対象の種類が run.json の target.kind と同じ語彙である', async () => {
      const adapter = makeAdapter();
      const session = await adapter.connect();
      expect(session.target.kind).toBe(adapter.kind);
      await session.close();
    });

    it('接続して得た target が、そのまま run.json に入る形になっている', async () => {
      // Adapter の出力を run.json 側で作り直さない。作り直すと、実際に繋いだ相手と
      // 証跡に書いた相手がずれても誰も気づけない。
      const adapter = makeAdapter();
      const session = await adapter.connect();
      const run = { ...validRun(), target: session.target };
      expect(validateRun(run)).toEqual({ valid: true, errors: [] });
      await session.close();
    });

    it('ライブビューを必ず持つ（C8）', async () => {
      // 「ライブ映像を出せるもの」が Adapter に入るという線引きそのもの。
      // 省略可能にすると、見るものが無い対象（API / CLI）が入ってくる。
      const adapter = makeAdapter();
      const session = await adapter.connect();
      expect(session.liveView).toBeDefined();
      await session.close();
    });

    it('ライブビューは開いた / 閉じたが外から分かる', async () => {
      const adapter = makeAdapter();
      const session = await adapter.connect();
      expect(session.liveView.isOpen).toBe(false);
      await session.liveView.open();
      expect(session.liveView.isOpen).toBe(true);
      await session.liveView.close();
      expect(session.liveView.isOpen).toBe(false);
      await session.close();
    });

    it('ライブビューを二重に開いても落ちない', async () => {
      const adapter = makeAdapter();
      const session = await adapter.connect();
      await session.liveView.open();
      await session.liveView.open();
      expect(session.liveView.isOpen).toBe(true);
      await session.close();
    });

    it('画面の状態は、対象の生データのまま返る', async () => {
      const adapter = makeAdapter();
      const session = await adapter.connect();
      const observation = await session.observe();
      expect(observation.kind).toBe(adapter.kind);
      expect(observation.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(observation).toHaveProperty('raw');
      await session.close();
    });

    it('スクリーンショットを取れる', async () => {
      const adapter = makeAdapter();
      const session = await adapter.connect();
      const shot = await session.screenshot();
      expect(shot.format).toBe('png');
      expect(shot.bytes.byteLength).toBeGreaterThan(0);
      await session.close();
    });

    it('閉じたセッションで操作すると落ちる', async () => {
      const adapter = makeAdapter();
      const session = await adapter.connect();
      await session.close();
      expect(session.isClosed).toBe(true);
      await expect(
        session.act({ kind: 'tap', target: { at: 'point', x: 1, y: 2 } }),
      ).rejects.toThrow(/閉じ/);
    });

    it('二重に閉じても落ちない', async () => {
      const adapter = makeAdapter();
      const session = await adapter.connect();
      await session.close();
      await session.close();
      expect(session.isClosed).toBe(true);
    });

    it('録画の状態が run.json にそのまま入る形で返る', async () => {
      const adapter = makeAdapter();
      const session = await adapter.connect();
      await session.recording.start(1);
      const recording = await session.recording.stop();
      const run = validRun();
      const base = run.cases[0];
      if (base === undefined) throw new Error('fixture が壊れている');
      expect(validateRun({ ...run, cases: [{ ...base, recording }] })).toEqual({
        valid: true,
        errors: [],
      });
      await session.close();
    });
  });
}
