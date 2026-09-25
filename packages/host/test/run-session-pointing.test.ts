import { fakeScreenPerCase } from './fake-screen.js';
import { describe, expect, it } from 'vitest';

import { parseTestSpecTsv } from '@git-qa/core';
import type { SessionState } from '@git-qa/core/session';
import type { LiveBridge, LiveBridgeOptions } from '@git-qa/live-bridge';

import { startRunSession } from '../src/index.js';
import { stubAdapter } from './stub-adapter.js';

/**
 * **指す場所は、いまの大きさで数える**（2026-09-25・人が実物で見つけた）。
 *
 * > デスクトップアプリを拡大しました。するとおそらくクリック位置がずれます。
 * > 元のサイズにすると押せるので。
 *
 * 相手の窓は走っている間に大きさが変わる（人が掴んで広げる）。
 * **実寸を 1 回だけ聞いて持ち続けると**、映像は新しい大きさで流れているのに、
 * 矢印と赤い枠だけが**古い大きさ**で置かれる —— **人は違う所を見に行く。**
 */

const SHEET = parseTestSpecTsv(
  [
    '#! md-business:test-spec-tsv/v1',
    'No.:number!\t項目!\t手順:multiline!\t期待結果:multiline!',
    '1\tメモを保存できる\t保存をタップする\t「保存しました」と表示される',
    '',
  ].join('\n'),
);

function fakeBridge(): {
  start: (options: LiveBridgeOptions) => Promise<LiveBridge>;
  states: SessionState[];
} {
  const states: SessionState[] = [];
  const bridge: LiveBridge = {
    url: 'http://127.0.0.1:65000/live/token.h264',
    controlUrl: 'http://127.0.0.1:65000/live/token/control',
    port: 65000,
    publish: (state) => states.push(state as SessionState),
    onInput: () => () => undefined,
    close: () => Promise.resolve(),
  };
  return { start: (_options: LiveBridgeOptions) => Promise.resolve(bridge), states };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const until = Date.now() + 2_500;
  while (Date.now() < until) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`待っても起きなかった: ${label}`);
}

describe('指した場所の知らせ', () => {
  it('窓の大きさが変わったら、そのあとの案内は新しい大きさで数える', async () => {
    const bridge = fakeBridge();
    let size = { width: 1280, height: 800 };
    let report:
      | ((at: { x: number; y: number; width?: number; height?: number; label?: string }) => void)
      | undefined;

    const session = await startRunSession({
      adapter: stubAdapter({ screen: () => size }),
      sheet: SHEET,
      sheetRef: { path: 'test.tsv', sha256: '0'.repeat(64) },
      runId: '20260925-150000',
      operator: { handle: 'octocat' },
      readScreenText: fakeScreenPerCase('保存しました'),
      startBridge: bridge.start,
      expectation: { waitMs: 0, stepMs: 1 },
      registerPointing: (fn) => {
        report = fn;
      },
    });

    // **人の番になってから指す。**走っている最中に指すと、判定へ移る所で消される
    // （そこは「人が見る番」なので、押した所の案内をわざと消している）。
    await waitFor(() => bridge.states.at(-1)?.awaiting === 1, '1 件目の打鍵待ち');
    report?.({ x: 100, y: 200, width: 40, height: 20, label: '保存' });
    await waitFor(() => bridge.states.at(-1)?.pointing !== undefined, '1 回目の案内');
    expect(bridge.states.at(-1)?.pointing?.screen).toEqual({ x: 1280, y: 800 });

    // 人が窓を掴んで小さくした。**映像はもう 900x620 で流れている。**
    size = { width: 900, height: 620 };
    report?.({ x: 100, y: 200, width: 40, height: 20, label: '保存' });
    await waitFor(
      () => bridge.states.at(-1)?.pointing?.screen.x === 900,
      '新しい大きさで置き直される',
    );
    expect(bridge.states.at(-1)?.pointing?.screen).toEqual({ x: 900, y: 620 });

    session.abort('検査の後始末');
    await session.done;
    await session.close();
  });
});
