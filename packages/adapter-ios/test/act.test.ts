import { describe, expect, it } from 'vitest';

import { iosAct, iosCapabilities } from '../src/adapter.js';
import type { WdaClient } from '../src/wda.js';

/**
 * **WDA の口があるときだけ、押す・打つ**（C99）。無ければ、今までどおり理由を言って止まる。
 * 撮る・読む（OCR）・WDA を偽物にして、**何をどの座標に頼んだか**を見る。
 */
const fake = (scale = 3) => {
  const done: string[] = [];
  const wda: WdaClient = {
    ready: () => Promise.resolve(true),
    scale: () => Promise.resolve(scale),
    tap: (at) => {
      done.push(`tap ${String(at.x)},${String(at.y)}`);
      return Promise.resolve();
    },
    type: (text) => {
      done.push(`type ${text}`);
      return Promise.resolve();
    },
    screenshot: () => Promise.resolve(new Uint8Array()),
    info: () => Promise.resolve({ model: 'iPhone', osVersion: '17.5.1', id: 'X' }),
    launch: (bundleId) => {
      done.push(`launch ${bundleId}`);
      return Promise.resolve();
    },
    home: () => {
      done.push('home');
      return Promise.resolve();
    },
    texts: () => Promise.resolve(''),
    windowSize: () => Promise.resolve({ width: 402, height: 874 }),
    navigation: () => Promise.resolve({ width: 402, height: 874 }),
    swipe: (from, to, ms) => {
      done.push(
        `swipe ${String(from.x)},${String(from.y)}→${String(to.x)},${String(to.y)} ${String(ms)}ms`,
      );
      return Promise.resolve();
    },
  };
  const deps = {
    wda,
    look: () => Promise.resolve('設定\t603\t1311\t90\t40\n一般\t300\t600\t60\t30'),
    // 試験では、画面が落ち着くのを待たない。
    settle: () => Promise.resolve(),
  };
  return { done, deps };
};

describe('iosCapabilities', () => {
  it('口が無ければ、押せない・打てないと名乗る', () => {
    expect(iosCapabilities(false).textInput).toBe('none');
  });
  it('口があれば、打てる・キーを送れる・識別子で開けると名乗る', () => {
    const can = iosCapabilities(true);
    expect(can.textInput).toBe('any');
    expect(can.keyInput).toBe(true);
    expect(can.appId).toBe('package-or-url');
  });
});

describe('iosAct', () => {
  it('文字で指したら、絵から探してポイントに直して押す', async () => {
    const { done, deps } = fake();

    const report = await iosAct({ kind: 'tap', target: { at: 'element', ref: '設定' } }, deps);

    expect(done).toEqual(['tap 201,437']);
    expect(report.detail).toContain('「設定」を WebDriverAgent で押した');
    expect(report.detail).toContain('（201, 437）');
  });

  /**
   * **押した座標がずれていたとき、足跡から原因が追えなかった**（2026-11-10・iPhone 17 の席）。
   * 見つけた部品の大きさ（ポイント）と、同じ文字が何件あったかを足跡に添える。
   */
  it('足跡に、見つけた部品の大きさ（ポイント）と同じ文字の件数が付く', async () => {
    const { deps } = fake();

    const report = await iosAct({ kind: 'tap', target: { at: 'element', ref: '設定' } }, deps);

    expect(report.detail).toContain('幅 30 × 高さ 13 pt');
    expect(report.detail).toContain('同じ文字 1 件');
  });

  /**
   * **キーボードが出て画面が動いている最中に読むと、動く前の位置を押す**（2026-11-10・iPhone 17 の席）。
   * 画面の文字が 2 回続けて同じになるまで読み直してから押す。
   */
  it('画面が動いている間は読み直し、落ち着いた位置を押す', async () => {
    const { done, deps } = fake();
    const frames = [
      '利用を開始する\t585\t1656\t360\t132', // 動く前
      '利用を開始する\t585\t1275\t360\t132', // 動いた後
      '利用を開始する\t585\t1275\t360\t132', // 同じ → 落ち着いた
    ];
    let reads = 0;
    const moving = {
      ...deps,
      look: () => Promise.resolve(frames[Math.min(reads++, frames.length - 1)] ?? ''),
      settle: () => Promise.resolve(),
    };

    await iosAct({ kind: 'tap', target: { at: 'element', ref: '利用を開始する' } }, moving);

    expect(done).toEqual(['tap 195,425']);
    expect(reads).toBe(3);
  });

  /**
   * **タブバーの裏に半分隠れた行の真ん中を押して、タブバーに当たっていた**（C118・2026-11-11・iPhone 17 の席）。
   * 「回線の設定」（y 777〜830 pt）が、下に浮くタブバー（y 790〜850 pt）と重なっていた。
   * 文字が読めても、棒と重なった所は押せる場所ではない。**見えている側の真ん中を押す。**
   */
  it('見つけた部品が棒（タブバー）と重なっていれば、見えている側の真ん中を押す', async () => {
    const { done, deps } = fake();
    const covered = {
      ...deps,
      wda: {
        ...deps.wda,
        navigation: () =>
          Promise.resolve({
            width: 402,
            height: 874,
            bars: [{ x: 0, y: 790, width: 402, height: 60 }],
          }),
      },
      // 「回線の設定」：真ん中 (201, 803) pt・高さ 53 pt → 画素 ×3
      look: () => Promise.resolve('回線の設定\t603\t2409\t1110\t159'),
    };

    const report = await iosAct(
      { kind: 'tap', target: { at: 'element', ref: '回線の設定' } },
      covered,
    );

    // 見えているのは y 776.5〜790 pt → 真ん中 783
    expect(done).toEqual(['tap 201,783']);
    expect(report.detail).toContain('下の棒と重なっていたので、見えている上側を押した');
  });

  it('見つけた部品が棒に全部隠れていれば、1 回だけ送って読み直してから押す', async () => {
    const { done, deps } = fake();
    const frames = [
      '回線の設定\t603\t2460\t1110\t159', // y 793.5〜846.5 pt → タブバー（790〜850）の裏
      '回線の設定\t603\t2460\t1110\t159',
      '回線の設定\t603\t1800\t1110\t159', // 送った後：y 573.5〜626.5 pt
      '回線の設定\t603\t1800\t1110\t159',
    ];
    let reads = 0;
    const hidden = {
      ...deps,
      wda: {
        ...deps.wda,
        navigation: () =>
          Promise.resolve({
            width: 402,
            height: 874,
            bars: [{ x: 0, y: 790, width: 402, height: 60 }],
          }),
      },
      look: () => Promise.resolve(frames[Math.min(reads++, frames.length - 1)] ?? ''),
    };

    const report = await iosAct(
      { kind: 'tap', target: { at: 'element', ref: '回線の設定' } },
      hidden,
    );

    expect(done[0]).toMatch(/^swipe 201,\d+→201,\d+ \d+ms$/);
    expect(done[1]).toBe('tap 201,600');
    expect(report.detail).toContain('下の棒に隠れていたので、1 回送ってから押した');
  });

  it('送っても棒に隠れたままなら、押さずに理由を言う', async () => {
    const { done, deps } = fake();
    const stuck = {
      ...deps,
      wda: {
        ...deps.wda,
        navigation: () =>
          Promise.resolve({
            width: 402,
            height: 874,
            bars: [{ x: 0, y: 790, width: 402, height: 60 }],
          }),
      },
      look: () => Promise.resolve('回線の設定\t603\t2460\t1110\t159'),
    };

    await expect(
      iosAct({ kind: 'tap', target: { at: 'element', ref: '回線の設定' } }, stuck),
    ).rejects.toThrow(/隠れていて押せない/);
    expect(done.filter((one) => one.startsWith('tap'))).toEqual([]);
  });

  it('棒と重なっていなければ、今までどおり真ん中を押す', async () => {
    const { done, deps } = fake();
    const clear = {
      ...deps,
      wda: {
        ...deps.wda,
        navigation: () =>
          Promise.resolve({
            width: 402,
            height: 874,
            bars: [{ x: 0, y: 790, width: 402, height: 60 }],
          }),
      },
    };

    await iosAct({ kind: 'tap', target: { at: 'element', ref: '設定' } }, clear);

    expect(done).toEqual(['tap 201,437']);
  });

  it('画面が落ち着いていれば、読むのは 2 回で済む', async () => {
    const { deps } = fake();
    let reads = 0;
    const still = {
      ...deps,
      look: () => (reads++, deps.look()),
      settle: () => Promise.resolve(),
    };

    await iosAct({ kind: 'tap', target: { at: 'element', ref: '設定' } }, still);

    expect(reads).toBe(2);
  });

  it('座標で指したら、画素をポイントに直して押す', async () => {
    const { done, deps } = fake();

    await iosAct({ kind: 'tap', target: { at: 'point', x: 300, y: 600 } }, deps);

    expect(done).toEqual(['tap 100,200']);
  });

  it('欄を指して打つなら、先に押してから打つ', async () => {
    const { done, deps } = fake();

    await iosAct({ kind: 'type', text: 'abc', target: { at: 'element', ref: '一般' } }, deps);

    expect(done).toEqual(['tap 100,200', 'type abc']);
  });

  it('見つからない文字は押さない（当てずっぽうで押さない）', async () => {
    const { done, deps } = fake();

    await expect(
      iosAct({ kind: 'tap', target: { at: 'element', ref: '一覧' } }, deps),
    ).rejects.toThrow(/画面に「一覧」が見つからない/);
    expect(done).toEqual([]);
  });

  it('口が無ければ、理由を言って止まる（今までどおり）', async () => {
    await expect(
      iosAct(
        { kind: 'tap', target: { at: 'point', x: 1, y: 1 } },
        { wda: undefined, look: () => Promise.resolve('') },
      ),
    ).rejects.toThrow(/WebDriverAgent/);
  });

  it('なぞるは、画素をポイントに直して WDA に頼む', async () => {
    const { done, deps } = fake();

    await iosAct(
      {
        kind: 'swipe',
        from: { at: 'point', x: 540, y: 1800 },
        to: { at: 'point', x: 540, y: 750 },
        durationMs: 300,
      },
      deps,
    );

    expect(done).toEqual(['swipe 180,600→180,250 300ms']);
  });

  /** **識別子（Bundle ID）で起動する**（2026-10-07）。名前から当てにいかない（C40）。 */
  it('アプリを識別子で起動する', async () => {
    const { done, deps } = fake();

    const report = await iosAct({ kind: 'launch', app: 'com.apple.Preferences' }, deps);

    expect(done).toEqual(['launch com.apple.Preferences']);
    expect(report.detail).toContain('com.apple.Preferences');
  });

  it('識別子でない名前では起動しない（当てずっぽうで起こさない）', async () => {
    const { done, deps } = fake();

    await expect(iosAct({ kind: 'launch', app: '設定' }, deps)).rejects.toThrow(/識別子/);
    expect(done).toEqual([]);
  });

  it('Enter キーは改行として打ち、Home キーはホーム画面へ戻る', async () => {
    const { done, deps } = fake();

    await iosAct({ kind: 'key', key: 'Enter' }, deps);
    await iosAct({ kind: 'key', key: 'Home' }, deps);

    expect(done).toEqual(['type \n', 'home']);
  });

  it('知らないキーは送らない（別の文字を打たない）', async () => {
    const { done, deps } = fake();

    await expect(iosAct({ kind: 'key', key: 'F5' }, deps)).rejects.toThrow(/送れないキー/);
    expect(done).toEqual([]);
  });

  it('まだ持たない操作は、そう言って止まる', async () => {
    const { deps } = fake();

    await expect(
      iosAct(
        { kind: 'drag', from: { at: 'point', x: 1, y: 1 }, to: { at: 'point', x: 2, y: 2 } },
        deps,
      ),
    ).rejects.toThrow(/まだ送れない/);
  });
});

/**
 * **タブバーの中の項目を「タブバーに隠れている」と見て押せなくなっていた**（2026-11-12・iPhone 17 の席）。
 * C118 の直しの後、タブバーの「設定」が「下の棒に隠れていて押せない」で BLOCKED になった。
 * 棒の中の部品は、棒に隠れているのではなく棒そのもの。**今までどおり真ん中を押す。**
 */
describe('iosAct — 棒の中の部品', () => {
  it('タブバーの中の「設定」は、隠れている扱いにせず、送らずに真ん中を押す', async () => {
    const { done, deps } = fake();
    const inBar = {
      ...deps,
      wda: {
        ...deps.wda,
        navigation: () =>
          Promise.resolve({
            width: 402,
            height: 874,
            bars: [{ x: 0, y: 790, width: 402, height: 84 }],
          }),
      },
      // 「設定」：真ん中 (328, 822) pt・高さ 48 pt、6 つ目の欄に「棒の中」の印
      look: () => Promise.resolve('設定\t984\t2466\t240\t144\tbar'),
    };

    const report = await iosAct({ kind: 'tap', target: { at: 'element', ref: '設定' } }, inBar);

    expect(done).toEqual(['tap 328,822']);
    expect(report.detail).not.toContain('棒');
  });
});
