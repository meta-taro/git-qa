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
    launch: (bundleId) => {
      done.push(`launch ${bundleId}`);
      return Promise.resolve();
    },
    home: () => {
      done.push('home');
      return Promise.resolve();
    },
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
