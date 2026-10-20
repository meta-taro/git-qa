import type { TargetSession } from '@git-qa/core';
import { describe, expect, it } from 'vitest';

import { listIosElements } from '../src/adapter.js';
import { pickByText } from '../src/wda.js';

/**
 * **iPhone / iPad でも、押せる名前を並べる**（2026-10-20）。
 *
 * 押す口（WebDriverAgent）があれば `element_tap` は画面の文字で探して押せたのに、
 * `element_list` だけが断っていた。AI は名前を知る口が無いので、
 * 「文字と座標を読む → 座標で押す → 撮って確かめる」の 3 往復に流れていた。
 *
 * **契約は他の相手と同じ。ここに並んだ名前は、そのまま押す側（pickByText）で見つかる。**
 */
const text = [
  ['一般', 187, 140, 120, 40],
  ['情報', 160, 444, 80, 48],
  ['機内モード', 200, 300, 200, 48],
  ['情報', 400, 444, 80, 48],
  ['', 10, 10, 10, 10],
]
  .map((cells) => cells.join('\t'))
  .join('\n');

const sessionSaying = (screenText: string): TargetSession =>
  ({
    observe: () => Promise.resolve({ kind: 'ios', capturedAt: '', raw: { screenText } }),
  }) as unknown as TargetSession;

describe('iPhone / iPad の押せる名前', () => {
  it('画面の文字を、重ねずに上から並べる', async () => {
    const names = await listIosElements(sessionSaying(text), { canPress: true });
    expect(names).toEqual(['一般', '機内モード', '情報']);
  });

  it('並んだ名前は、どれも押す側で見つかる', async () => {
    const names = await listIosElements(sessionSaying(text), { canPress: true });
    for (const name of names) expect(pickByText(text, name)).toBeDefined();
  });

  it('押す口が無ければ、並べずに理由を言って断る', async () => {
    await expect(listIosElements(sessionSaying(text), { canPress: false })).rejects.toThrow(
      /GIT_QA_IOS_WDA/,
    );
  });

  it('文字が 1 つも読めなければ、空を返さずに断る', async () => {
    await expect(listIosElements(sessionSaying(''), { canPress: true })).rejects.toThrow(
      /読めなかった/,
    );
  });
});
