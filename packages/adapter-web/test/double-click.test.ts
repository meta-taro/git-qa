import { describe, expect, it } from 'vitest';

import type { CdpClient, CdpParams } from '../src/cdp.js';
import { dispatchWebAction } from '../src/adapter.js';

/**
 * **ダブルクリック**（meta-taro/git-qa#42 の改善案）。
 *
 * ブラウザは `clickCount` を見て `dblclick` を起こす。**1 回目は 1、2 回目は 2** で送る
 * （2 回とも 1 で送ると、ページには単なるクリック 2 回として届く）。
 */
describe('dispatchWebAction — ダブルクリック', () => {
  it('押して離すを 2 回、clickCount 1 → 2 で送る', async () => {
    const sent: CdpParams[] = [];
    const cdp: CdpClient = {
      send: (_method, params) => {
        sent.push(params ?? {});
        return Promise.resolve({});
      },
      on: () => () => undefined,
      close: () => Promise.resolve(),
    };

    await dispatchWebAction(cdp, { kind: 'doubleTap', target: { at: 'point', x: 10, y: 20 } });

    expect(sent.map((p) => [p['type'], p['clickCount']])).toEqual([
      ['mouseMoved', undefined],
      ['mousePressed', 1],
      ['mouseReleased', 1],
      ['mousePressed', 2],
      ['mouseReleased', 2],
    ]);
  });
});
