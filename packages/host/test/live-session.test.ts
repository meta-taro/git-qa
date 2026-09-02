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
