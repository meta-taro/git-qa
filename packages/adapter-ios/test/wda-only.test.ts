import { describe, expect, it } from 'vitest';

import { encodeFrame } from '@git-qa/core';

import { createIosAdapter, wdaMjpegUrl } from '../src/adapter.js';
import type { WdaClient } from '../src/wda.js';

/**
 * **WebDriverAgent だけで動く形**（2026-10-07・Windows から iPhone を扱うため）。
 *
 * USB で映す道具（`git-qa-ios`）は macOS でしか建たない。WDA は網越しの HTTP なので、
 * **一覧・画面の絵・映像・押す**を全部 WDA から取れば、OS を選ばない。
 * 道具が無く口があれば、この形で繋ぐ。
 */
const wda = (ready = true): WdaClient => ({
  ready: () => Promise.resolve(ready),
  scale: () => Promise.resolve(3),
  tap: () => Promise.resolve(),
  type: () => Promise.resolve(),
  screenshot: () => Promise.resolve(new Uint8Array([0x89, 0x50])),
  launch: () => Promise.resolve(),
  home: () => Promise.resolve(),
  swipe: () => Promise.resolve(),
  texts: () => Promise.resolve('一般\t300\t600\t120\t60'),
  navigation: () => Promise.resolve({ width: 402, height: 874 }),
  info: () => Promise.resolve({ model: 'iPhone', osVersion: '17.5.1', id: 'ABCDEF' }),
});

const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);

describe('wdaMjpegUrl', () => {
  it('同じ宛先の 9100 番（WDA の既定）', () => {
    expect(wdaMjpegUrl('http://192.0.2.10:8100')).toBe('http://192.0.2.10:9100/');
  });
});

describe('createIosAdapter — WebDriverAgent だけで', () => {
  it('道具が無く口があれば、口に聞いて繋ぐ（名前は残さない）', async () => {
    const session = await createIosAdapter({
      wdaUrl: 'http://192.0.2.10:8100',
      wda: wda(),
      build: { source: 'ios', label: 'test' },
    }).connect();

    expect(session.target.device).toBe('iPhone（iOS 17.5.1）');
    await session.close();
  });

  it('口が生きていなければ、繋がずに理由を言う', async () => {
    await expect(
      createIosAdapter({
        wdaUrl: 'http://192.0.2.10:8100',
        wda: wda(false),
        build: { source: 'ios', label: 'test' },
      }).connect(),
    ).rejects.toThrow(/WebDriverAgent/);
  });

  /**
   * **絵から読む道具が無くても、口から画面の文字を読む**（2026-10-13・Windows の席で踏んだ）。
   * 読めないと、判定は「文字が現れなかった」になり、押す所も探せなかった。
   */
  it('絵から読む道具が無ければ、画面の文字は口（部品の名前）から読む', async () => {
    const session = await createIosAdapter({
      wdaUrl: 'http://192.0.2.10:8100',
      wda: wda(),
      build: { source: 'ios', label: 'test' },
    }).connect();

    const seen = await session.observe();
    expect((seen.raw as { screenText: string }).screenText).toContain('一般');
    await session.close();
  });

  it('絵から読む道具が無くても、文字で指せば口から位置を探して押す', async () => {
    const tapped: { x: number; y: number }[] = [];
    const session = await createIosAdapter({
      wdaUrl: 'http://192.0.2.10:8100',
      wda: { ...wda(), tap: (at) => (tapped.push(at), Promise.resolve()) },
      build: { source: 'ios', label: 'test' },
    }).connect();

    await session.act({ kind: 'tap', target: { at: 'element', ref: '一般' } });
    expect(tapped).toEqual([{ x: 100, y: 200 }]);
    await session.close();
  });

  it('道具も口も無ければ、繋げないと言う', async () => {
    await expect(
      createIosAdapter({ build: { source: 'ios', label: 'test' } }).connect(),
    ).rejects.toThrow(/GIT_QA_IOS_WDA/);
  });

  it('映像は映像の口から読み、画面が読める形（長さで包む）で流す', async () => {
    async function* stream(): AsyncIterable<Uint8Array> {
      yield await Promise.resolve(
        new TextEncoder().encode(`--B\r\nContent-Length: ${String(jpeg.length)}\r\n\r\n`),
      );
      yield jpeg;
    }
    const opened: string[] = [];
    const session = await createIosAdapter({
      wdaUrl: 'http://192.0.2.10:8100',
      wda: wda(),
      openStream: (url) => {
        opened.push(url);
        return stream();
      },
      build: { source: 'ios', label: 'test' },
    }).connect();

    await session.liveView.open();
    const got: Uint8Array[] = [];
    for await (const one of session.liveView.frames!()) got.push(one);

    expect(opened).toEqual(['http://192.0.2.10:9100/']);
    expect(got).toEqual([encodeFrame(jpeg)]);
    await session.close();
  });
});
