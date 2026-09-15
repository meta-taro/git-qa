import { describe, expect, it } from 'vitest';

import { liveStallMessage } from '../../src/live/stall.js';

/**
 * **届いているのに描けていないなら、そう言う**（meta-taro/git-qa#18）。
 *
 * 映像の種類を取り違えて、**JPEG を H.264 の復号器へ流し込んでいた。**
 * 復号器は待つだけなので、**例外も出ず、記録にも何も出ず、ただ真っ白**になった。
 * 人には「映らない」としか見えず、こちらも入口を 2 つ比べるまで気づけなかった。
 *
 * **「来ていない」と「描けていない」は別の話。**分けて言えば、次は 1 行で分かる。
 */
describe('liveStallMessage', () => {
  it('届いているのに 1 枚も描けていないなら、言う', () => {
    const said = liveStallMessage({ bytes: 120_000, drawn: 0, kind: 'h264' });

    expect(said).toContain('h264');
    // **何が起きているかと、次に見る所**を言う（「映りません」だけにしない）。
    expect(said).toContain('届いて');
  });

  it('描けているなら、黙る', () => {
    expect(liveStallMessage({ bytes: 120_000, drawn: 5, kind: 'images' })).toBeUndefined();
  });

  /** **来ていないのは別の話。**そちらは繋ぎ直しの側で扱う（そう書かないと原因を取り違える）。 */
  it('1 バイトも来ていないなら、これは言わない', () => {
    expect(liveStallMessage({ bytes: 0, drawn: 0, kind: 'h264' })).toBeUndefined();
  });
});
