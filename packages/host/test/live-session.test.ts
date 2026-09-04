import { describe, expect, it } from 'vitest';

import { createAnnexBSplitter } from '@git-qa/core';

import { startLiveSession } from '../src/index.js';
import { stubAdapter } from './stub-adapter.js';

describe('startLiveSession', () => {
  it('繋いで、ライブビューを開いて、画面が読む URL を返す', async () => {
    const adapter = stubAdapter({});
    const live = await startLiveSession({ adapter });
    try {
      expect(adapter.opened).toEqual(['session', 'liveView']);
      expect(live.liveUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/live\/[0-9a-f]{32}\.h264$/);
    } finally {
      await live.close();
    }
  });

  it('返した URL から、実際に映像が読める', async () => {
    // 部品が揃っていても繋がっていないことがある。ここは本物の HTTP を通す。
    const adapter = stubAdapter({});
    const live = await startLiveSession({ adapter });
    try {
      const res = await fetch(live.liveUrl);
      const splitter = createAnnexBSplitter();
      const units = [
        ...splitter.push(new Uint8Array(await res.arrayBuffer())),
        ...splitter.flush(),
      ];
      expect(units.map((u) => u.isKey)).toEqual([true, false]);
    } finally {
      await live.close();
    }
  });

  it('繋いだセッションをそのまま渡す（作り直さない）', async () => {
    // 実行器が同じセッションで操作する。別物を渡すと、見ている画面と触る相手がずれる。
    const adapter = stubAdapter({});
    const live = await startLiveSession({ adapter });
    try {
      expect(live.session.target.kind).toBe('android');
    } finally {
      await live.close();
    }
  });

  it('閉じると、橋・ライブビュー・セッションを全部閉じる', async () => {
    const adapter = stubAdapter({});
    const live = await startLiveSession({ adapter });
    const url = live.liveUrl;
    await live.close();

    expect(adapter.closed).toEqual(['liveView', 'session']);
    await expect(fetch(url)).rejects.toThrow();
  });

  it('二重に閉じても落ちない', async () => {
    const adapter = stubAdapter({});
    const live = await startLiveSession({ adapter });
    await live.close();
    await live.close();

    expect(adapter.closed).toEqual(['liveView', 'session']);
  });

  it('映像を読む口が無いアダプタなら、握り潰さずに落ちる', async () => {
    // 別窓の方式のアダプタを渡された場合。空の枠を出すと、映らない理由が人に分からない。
    const adapter = stubAdapter({ mode: 'external-window' });
    await expect(startLiveSession({ adapter })).rejects.toThrow(/映像を読む口/);
  });

  it('映像を読む口が無いときも、開いたセッションを閉じてから投げる', async () => {
    // 閉じずに投げると、端末を掴んだまま離さない。
    const adapter = stubAdapter({ mode: 'external-window' });
    await expect(startLiveSession({ adapter })).rejects.toThrow();

    expect(adapter.closed).toContain('session');
  });

  it('橋を起こせなかったら、ライブビューとセッションを閉じてから投げる', async () => {
    // ここを閉じ忘れると、端末の画面を吸い出すプロセスが残ったままになる。
    const adapter = stubAdapter({});
    await expect(
      startLiveSession({
        adapter,
        startBridge: () => Promise.reject(new Error('橋を起こせない')),
      }),
    ).rejects.toThrow(/橋を起こせない/);

    expect(adapter.closed).toEqual(['liveView', 'session']);
  });

  it('ライブビューを開けなかったら、セッションを閉じてから投げる', async () => {
    const adapter = stubAdapter({ failOpen: true });
    await expect(startLiveSession({ adapter })).rejects.toThrow(/開けない/);

    expect(adapter.closed).toContain('session');
  });
});

/**
 * **検証中にケーブルが抜けたら、挿し直しで戻る**（Issue 014）。
 *
 * 実物を使った人の報告: 「検証中にケーブルが抜けたら、再度さしても再開できないです」。
 *
 * 映像が落ちた理由を控えるだけで、**誰も繋ぎ直しに来ていなかった。**橋の中身が尽き、
 * 画面は最後の 1 枚で固まる。挿し直しても戻らない。
 *
 * **黙って無限に繋ぎ直すのも駄目。**「繋ぎ直しを繰り返すと、黙ったまま回り続ける」は
 * この道具が既に 1 度踏んだ穴。待っていることを言い、上限で止まる。
 */
describe('映像の繋ぎ直し（Issue 014）', () => {
  /** 橋の代わり。**流れてくる映像をそのまま受け取る。** */
  const captureBridge = () => {
    let source: (() => AsyncIterable<Uint8Array>) | undefined;
    return {
      start: (options: { source: () => AsyncIterable<Uint8Array> }) => {
        source = options.source;
        return Promise.resolve({
          url: 'http://127.0.0.1:65001/live/token.h264',
          controlUrl: 'http://127.0.0.1:65001/live/token/control',
          port: 65001,
          publish: () => undefined,
          onInput: () => () => undefined,
          close: () => Promise.resolve(),
        });
      },
      read: async (): Promise<Uint8Array[]> => {
        const got: Uint8Array[] = [];
        for await (const chunk of source?.() ?? []) got.push(chunk);
        return got;
      },
    };
  };

  const noWait = { intervalMs: 1, limitMs: 50, sleep: () => Promise.resolve() };

  it('落ちても繋ぎ直して、続きを流す', async () => {
    // 1 回落ちて、挿し直された。
    const adapter = stubAdapter({ failFrames: '端末が見つからない', failFramesTimes: 1 });
    const bridge = captureBridge();
    const live = await startLiveSession({
      adapter,
      startBridge: bridge.start,
      reconnect: noWait,
    });

    const chunks = await bridge.read();

    expect(chunks.length).toBeGreaterThan(0);
    // 1 回目は落ちた分、2 回目で読めた。**繋ぎ直しに来ている。**
    expect(adapter.frameStarts()).toBe(2);
    await live.close();
  });

  it('繋ぎ直している間、何を待っているかを伝える', async () => {
    const adapter = stubAdapter({ failFrames: '端末が見つからない', failFramesTimes: 1 });
    const bridge = captureBridge();
    const notices: (string | undefined)[] = [];
    const live = await startLiveSession({
      adapter,
      startBridge: bridge.start,
      reconnect: noWait,
      onLiveError: (message) => notices.push(message),
    });

    await bridge.read();

    // 理由と、繋ぎ直していることの両方が要る。**黙って固まらない。**
    expect(notices[0]).toMatch(/端末が見つからない/);
    expect(notices[0]).toMatch(/繋ぎ直/);
    await live.close();
  });

  it('戻ったら、出していた理由を消す', async () => {
    const adapter = stubAdapter({ failFrames: '端末が見つからない', failFramesTimes: 1 });
    const bridge = captureBridge();
    const notices: (string | undefined)[] = [];
    const live = await startLiveSession({
      adapter,
      startBridge: bridge.start,
      reconnect: noWait,
      onLiveError: (message) => notices.push(message),
    });

    await bridge.read();

    // **戻ったのに理由が出たままだと、直っていないように見える。**
    expect(notices.at(-1)).toBeUndefined();
    await live.close();
  });

  it('戻らないまま上限に達したら、理由を出して止まる（黙って回り続けない）', async () => {
    const adapter = stubAdapter({ failFrames: '端末が見つからない' });
    const bridge = captureBridge();
    const notices: (string | undefined)[] = [];
    const live = await startLiveSession({
      adapter,
      startBridge: bridge.start,
      reconnect: noWait,
      onLiveError: (message) => notices.push(message),
    });

    await expect(bridge.read()).rejects.toThrow(/端末が見つからない/);

    // 何秒待ったのかまで言う。**言わないと、待てば戻るのかが分からない。**
    expect(notices.at(-1)).toMatch(/端末が見つからない/);
    expect(notices.at(-1)).toMatch(/待っても戻らな/);
    await live.close();
  });

  it('閉じた後は繋ぎ直さない（端末を掴んだままにしない）', async () => {
    const adapter = stubAdapter({ failFrames: '端末が見つからない' });
    const bridge = captureBridge();
    const live = await startLiveSession({
      adapter,
      startBridge: bridge.start,
      reconnect: noWait,
    });

    await live.close();
    await expect(bridge.read()).rejects.toThrow();

    expect(adapter.frameStarts()).toBe(1);
  });
});
