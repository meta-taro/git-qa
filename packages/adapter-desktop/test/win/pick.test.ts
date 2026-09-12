import { describe, expect, it } from 'vitest';

import { whyNoDesktop } from '../../src/win/pick.js';

/**
 * **どちらの OS で見るかを決める**（2026-09-12）。
 *
 * macOS と Windows は**別のソース**にしてある（2026-09-07 の人の指定）。
 * 窓の探し方も文字の読み方も押し方も考え方が違い、1 本にまとめると
 * **どちらの都合でもない分岐**が増える。
 *
 * **持っていない OS では、持っていないと言う。**黙って空の画面を出さない。
 */
describe('whyNoDesktop', () => {
  it('macOS は見られる', () => {
    expect(whyNoDesktop('darwin', '/どこか/git-qa-win')).toBeUndefined();
  });

  it('Windows は、道具があれば見られる', () => {
    expect(whyNoDesktop('win32', 'C:\\どこか\\git-qa-win.exe')).toBeUndefined();
  });

  /** **道具が無ければ、無いと言う。**配布物に入っていない・建てていない、が普通にある。 */
  it('Windows で道具が無ければ、理由を言う', () => {
    const why = whyNoDesktop('win32', undefined);

    expect(why).toContain('git-qa-win');
  });

  /** Linux は持っていない。**いつか作るとしても、いまは無い。** */
  it('持っていない OS は、持っていないと言う', () => {
    expect(whyNoDesktop('linux', undefined)).toContain('linux');
  });
});
