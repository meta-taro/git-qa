import { describe, expect, it } from 'vitest';

import { logLine } from '../src/console-log.js';

/**
 * **失敗の理由を、記録で失わない**（meta-taro/git-qa#18）。
 *
 * 映像が出ないとき、記録にはこう出ていた。
 *
 * ```text
 * [live-view] {}
 * ```
 *
 * `JSON.stringify(new Error('Load failed'))` は **`{}`** になる。
 * **理由がそこで消えていた。**「映らない」を調べる人が、いちばん見たい 1 語が落ちる。
 */
describe('logLine', () => {
  it('失敗の理由を落とさない', () => {
    expect(logLine(['[live-view]', new Error('Load failed')])).toBe('[live-view] Load failed');
  });

  it('名前のある失敗は、名前も残す', () => {
    const error = new TypeError('壊れた形');

    expect(logLine([error])).toBe('TypeError: 壊れた形');
  });

  it('文字はそのまま', () => {
    expect(logLine(['押せなかった', 'ボタン'])).toBe('押せなかった ボタン');
  });

  it('ふつうの値は、今までどおり形のまま', () => {
    expect(logLine([{ n: 1 }])).toBe('{"n":1}');
  });

  /** **輪になっている値でも、記録を止めない。**診断のために本筋を止めない。 */
  it('写せない値でも、落とさない', () => {
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;

    expect(logLine([loop])).toContain('[object');
  });
});
