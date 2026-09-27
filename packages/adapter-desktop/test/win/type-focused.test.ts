import { beforeEach, describe, expect, it } from 'vitest';

import { createWindowsDesktopAdapter } from '../../src/win/adapter.js';

/**
 * **欄を指さない「入力する」を、Windows でも通す**（meta-taro/git-qa#42）。
 *
 * 日付欄（`input type=date`）の年を 4 桁で止める、という検証は
 * **1 キーごとに走る制限**を見ている。`SetValue` は値を丸ごと置き換えるので
 * **その制限を通らない** —— 確かめたいものを迂回してしまう。
 * だから欄を指さない形は、**焦点のある欄へ 1 文字ずつ打つ**（macOS の `keystroke` と同じ意味）。
 *
 * 実物の道具（`git-qa-win`）は Windows でしか動かないので、ここでは
 * **呼ばれた引数を書き残すだけの偽物**を置き、何を頼んだかを見る。
 */

const WINDOW_LINE = [
  '4242',
  '100',
  'C:\\app\\md-business.exe',
  'md-business',
  '0',
  '0',
  '800',
  '600',
].join('\t');

const build = { source: 'md-business', label: 'test' };

/**
 * **偽の道具。プロセスは起こさない**（2026-09-27）。
 *
 * 前はシェルスクリプトを置いて起こしていた。**macOS では新しい実行ファイルを初めて起こすときの
 * OS の検査で 5 秒を超え、時々落ちた**（CI の Linux では通るので、手元でだけ落ちる形だった）。
 * 呼ばれた引数を残し、`text` と `press` には決めた文字を返す。`windows` は md-business にだけ窓を返す。
 */
let sent: string[][];
let output: { text: string; press: string };

const runTool = (args: readonly string[]): Promise<string> => {
  sent.push([...args]);
  if (args[0] === 'windows')
    return Promise.resolve(args[1] === 'md-business' ? `${WINDOW_LINE}\n` : '');
  if (args[0] === 'text') return Promise.resolve(output.text);
  if (args[0] === 'press') return Promise.resolve(output.press);
  return Promise.resolve('');
};

const toolPath = '（試験では起こさない）';

beforeEach(() => {
  sent = [];
  output = { text: '年\t10\t20\t30\t12\n', press: '' };
});

/** 道具が `text` と `press` に何を返すか。 */
function says(out: { text: string; press: string }): void {
  output = out;
}

function calls(): Promise<string[][]> {
  return Promise.resolve(sent);
}

describe('Windows の「入力する」', () => {
  it('欄を指さなければ、焦点のある欄へ 1 文字ずつ打つ（窓を添えて）', async () => {
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();

    await session.act({ kind: 'type', text: '20260903' });

    expect((await calls()).filter((c) => c[0] !== 'windows')).toEqual([
      ['keys', '4242', '20260903'],
    ]);
  });

  /** 欄を指す形は変えない（#9 で実測した `SetValue` のまま）。 */
  it('欄を指せば、今までどおりその欄の値を置き換える', async () => {
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();

    await session.act({ kind: 'type', text: 'abc', target: { at: 'element', ref: '年' } });

    const sent = (await calls()).filter((c) => c[0] !== 'windows' && c[0] !== 'text');
    expect(sent.map((c) => [c[0], c[1], c[4]])).toEqual([['type', '4242', 'abc']]);
  });
});

/**
 * **「アプリを起動する」を、Windows でも止めない**（meta-taro/git-qa#42）。
 *
 * 検証シートは、ほぼ必ず 1 行目がこれ。Windows には起動の口が無く、**最初の行で BLOCKED** になっていた。
 * macOS と同じく、**窓が出ていれば何もしない。**出ていなければ起動はせず、理由を言って止まる
 * （名前から実行ファイルを当てにいくと、別のものを起こしかねない・C40）。
 */
describe('Windows の「アプリを起動する」', () => {
  it('窓がもう出ていれば、何も起こさずに通る', async () => {
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();

    await session.act({ kind: 'launch', app: 'md-business' });

    expect((await calls()).every((c) => c[0] === 'windows')).toBe(true);
  });

  it('窓が無ければ、起動せずに理由を言って止まる', async () => {
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();

    await expect(session.act({ kind: 'launch', app: 'よそのアプリ' })).rejects.toThrow(
      /起動していない/,
    );
  });
});

/**
 * **何をどう押したかを返す**（meta-taro/git-qa#42）。
 *
 * > 候補が 2 つ以上あったら、選んだものを証跡に書く（種類・名前・座標）。
 * > 本物のクリックは…「画面を使う手順」だと証跡に残しておくと、人が触っていたときの誤作動を切り分けやすくなります。
 */
describe('Windows の「押す」が言うこと', () => {
  const withTool = async (text: string, pressSays: string): Promise<string> => {
    says({ text, press: pressSays });
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();
    const report = await session.act({ kind: 'tap', target: { at: 'element', ref: '開く' } });
    return report === undefined ? '' : report.detail;
  };

  it('本物のクリックで押したら、種類・名前・座標とともにそう言う', async () => {
    const detail = await withTool('開く\t560\t390\t80\t28\tButton\n', 'click');

    expect(detail).toBe('「開く」（Button）を本物のクリックで押した（560, 390）');
  });

  it('Invoke に落ちたら、そう言う', async () => {
    const detail = await withTool('開く\t560\t390\t80\t28\tButton\n', 'invoke');

    expect(detail).toContain('Invoke で押した');
  });

  it('同じ名前が 2 つあれば、候補の数と選び方も言う', async () => {
    const detail = await withTool(
      '開く\t400\t300\t480\t240\tWindow\n開く\t560\t390\t80\t28\tButton\n',
      'click',
    );

    expect(detail).toContain('（Button）');
    expect(detail).toContain('同じ名前が 2 つ（Button / Window）。いちばん小さいものを採った');
  });
});
