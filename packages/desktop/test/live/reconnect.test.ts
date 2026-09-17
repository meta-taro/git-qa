import { describe, expect, it } from 'vitest';

import { nextRetryMs, retryMessage } from '../../src/live/reconnect.js';

/**
 * **映像が切れたら、繋ぎ直す**（外部レビュー meta-taro/git-qa#33）。
 *
 * > Load failed になりましたね。**このとき再接続みたいな案内がないのと、殺風景です。**
 *
 * 出ていたのは `Load failed` の 4 文字だけ。**再接続の案内も、押し直す口も、
 * 何が起きたのかも書かれていない。**
 *
 * 開発モードでは、Vite の再読み込みで**毎回踏む**。
 */
describe('nextRetryMs', () => {
  it('だんだん間を空ける（相手が落ちているときに叩き続けない）', () => {
    expect(nextRetryMs(0)).toBeLessThan(nextRetryMs(1));
    expect(nextRetryMs(1)).toBeLessThan(nextRetryMs(2));
  });

  it('最初は短い（すぐ戻ることが多い）', () => {
    expect(nextRetryMs(0)).toBeLessThanOrEqual(1000);
  });

  /** **無限に伸ばさない。**人が挿し直したときに、待たされ続けない。 */
  it('上限を超えない', () => {
    expect(nextRetryMs(99)).toBeLessThanOrEqual(10_000);
  });
});

describe('retryMessage', () => {
  /** **何が切れたのかと、次に何が起きるか**を言う。「Load failed」だけにしない。 */
  it('繋ぎ直すことを言う', () => {
    const said = retryMessage('Load failed', 3200);

    expect(said).toContain('映像');
    expect(said).toContain('繋ぎ直');
    // **元の言い分も落とさない。**原因を追う人には、それが要る。
    expect(said).toContain('Load failed');
  });

  it('待ち時間を秒で言う', () => {
    expect(retryMessage('x', 3200)).toContain('3.2');
  });
});
