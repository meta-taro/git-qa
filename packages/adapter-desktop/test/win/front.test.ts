import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWindowsDesktopAdapter } from '../../src/win/adapter.js';

/**
 * **押したあと、すぐには前面を返さない**（C108・macOS の #32 と同じ）。
 *
 * Windows の道具は押すたびに前面を元の窓へ返していた。相手の窓が裏へ回ると、
 * Chromium は開いている選択肢（`select` の一覧）を畳む。**「開く → 選ぶ」の 2 手目で、
 * もう一覧が無かった。**押し続けている間は相手を前に置き、**手が止まってから** git-qa の窓へ返す。
 *
 * **キーで画面を送った直後は、位置が落ち着くまで読み直す**（C108）。
 * なめらかに動く画面では、送った直後に読むと、**動いている途中の位置**を押していた。
 */

const line = (hwnd: number, exe: string, title: string): string =>
  [String(hwnd), '100', `C:\\app\\${exe}.exe`, title, '0', '0', '800', '600'].join('\t');

let sent: string[][];
let texts: string[];

const runTool = (args: readonly string[]): Promise<string> => {
  sent.push([...args]);
  if (args[0] === 'windows') {
    if (args[1] === 'md-business') return Promise.resolve(`${line(4242, 'md-business', 'md')}\n`);
    if (args[1] === 'git-qa') return Promise.resolve(`${line(777, 'git-qa', 'git-qa')}\n`);
    return Promise.resolve('');
  }
  // 読むたびに次の答え。最後の答えは繰り返す。
  if (args[0] === 'text') return Promise.resolve(texts.length > 1 ? texts.shift()! : texts[0]!);
  if (args[0] === 'press') return Promise.resolve('click');
  return Promise.resolve('');
};

const connect = () =>
  createWindowsDesktopAdapter({
    app: 'md-business',
    toolPath: '（試験では起こさない）',
    build: { source: 'md-business', label: 'test' },
    runTool,
    pause: () => Promise.resolve(),
  }).connect();

const fronts = (): string[][] => sent.filter((c) => c[0] === 'front');

beforeEach(() => {
  sent = [];
  texts = ['保存\t300\t200\t40\t20\tButton\n'];
});

describe('Windows — 前面を返すのは手が止まってから', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('押した直後には返さず、静かになったら git-qa の窓へ返す', async () => {
    const session = await connect();

    await session.act({ kind: 'tap', target: { at: 'element', ref: '保存' } });
    expect(fronts()).toEqual([]);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fronts()).toEqual([['front', '777']]);
  });

  it('続けて押している間は返さない（開いた一覧を畳まない）', async () => {
    const session = await connect();

    await session.act({ kind: 'tap', target: { at: 'element', ref: '保存' } });
    await vi.advanceTimersByTimeAsync(500);
    await session.act({ kind: 'tap', target: { at: 'element', ref: '保存' } });
    await vi.advanceTimersByTimeAsync(500);
    expect(fronts()).toEqual([]);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fronts()).toEqual([['front', '777']]);
  });

  it('キーを押したあとも、静かになったら返す', async () => {
    const session = await connect();

    await session.act({ kind: 'key', key: 'End' });
    expect(fronts()).toEqual([]);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fronts()).toEqual([['front', '777']]);
  });

  it('git-qa の窓が無ければ、何もしない（無人の実行）', async () => {
    const session = await connect();
    const lonely = (args: readonly string[]): Promise<string> =>
      args[0] === 'windows' && args[1] === 'git-qa' ? Promise.resolve('') : runTool(args);
    const alone = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath: '（試験では起こさない）',
      build: { source: 'md-business', label: 'test' },
      runTool: lonely,
      pause: () => Promise.resolve(),
    }).connect();
    void session;

    await alone.act({ kind: 'tap', target: { at: 'element', ref: '保存' } });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fronts()).toEqual([]);
  });
});

describe('Windows — キーで送った直後は、位置が落ち着くまで読み直す', () => {
  it('動いている途中の位置ではなく、止まった位置を押す', async () => {
    const session = await connect();
    await session.act({ kind: 'key', key: 'PageDown' });
    texts = [
      '保存\t300\t500\t40\t20\tButton\n',
      '保存\t300\t300\t40\t20\tButton\n',
      '保存\t300\t200\t40\t20\tButton\n',
      '保存\t300\t200\t40\t20\tButton\n',
    ];

    await session.act({ kind: 'tap', target: { at: 'element', ref: '保存' } });

    expect(sent.find((c) => c[0] === 'press')).toEqual(['press', '4242', '300', '200']);
  });

  it('キーを押していなければ、読み直さない', async () => {
    const session = await connect();

    await session.act({ kind: 'tap', target: { at: 'element', ref: '保存' } });

    expect(sent.filter((c) => c[0] === 'text')).toHaveLength(1);
  });

  it('落ち着かなければ、最後に読んだ位置を押す（止まらない）', async () => {
    const session = await connect();
    await session.act({ kind: 'key', key: 'PageDown' });
    let y = 900;
    texts = [];
    const moving = (args: readonly string[]): Promise<string> => {
      if (args[0] === 'text') {
        y -= 10;
        return Promise.resolve(`保存\t300\t${String(y)}\t40\t20\tButton\n`);
      }
      return runTool(args);
    };
    const drifting = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath: '（試験では起こさない）',
      build: { source: 'md-business', label: 'test' },
      runTool: moving,
      pause: () => Promise.resolve(),
    }).connect();
    await drifting.act({ kind: 'key', key: 'PageDown' });
    void session;

    await drifting.act({ kind: 'tap', target: { at: 'element', ref: '保存' } });

    const press = sent.filter((c) => c[0] === 'press').at(-1);
    expect(press?.[3]).toBe(String(y));
  });
});
