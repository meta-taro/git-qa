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
let output: { text: string; press: string; keys?: string; key?: string };

const runTool = (args: readonly string[]): Promise<string> => {
  sent.push([...args]);
  if (args[0] === 'windows')
    return Promise.resolve(args[1] === 'md-business' ? `${WINDOW_LINE}\n` : '');
  if (args[0] === 'text') return Promise.resolve(output.text);
  if (args[0] === 'press') return Promise.resolve(output.press);
  if (args[0] === 'keys') return Promise.resolve(output.keys ?? '');
  if (args[0] === 'key') return Promise.resolve(output.key ?? '');
  return Promise.resolve('');
};

const toolPath = '（試験では起こさない）';

beforeEach(() => {
  sent = [];
  output = { text: '年\t10\t20\t30\t12\n', press: '' };
});

/** 道具が `text` と `press` に何を返すか。 */
function says(out: { text: string; press: string; keys?: string; key?: string }): void {
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

/**
 * **種類つきで押す**（#42 の改善案）。名前が同じでも、**書かれた種類のものだけ**を候補にする。
 * 窓のほうを小さくしておき、「小さいほう」ではなく「種類」で選んでいることを確かめる。
 */
describe('Windows の「「開く」ボタンをクリックする」', () => {
  const lines = '開く\t400\t300\t40\t20\tWindow\n開く\t560\t390\t80\t28\tButton\n';

  it('書かれた種類（Button）のものを押す', async () => {
    says({ text: lines, press: 'click' });
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();

    const report = await session.act({
      kind: 'tap',
      target: { at: 'element', ref: '開く', kind: 'button' },
    });

    expect(sent.find((c) => c[0] === 'press')).toEqual(['press', '4242', '560', '390']);
    expect(report === undefined ? '' : report.detail).toContain('（Button）');
  });

  it('その種類のものが無ければ、押さずに何が在ったかを言う', async () => {
    says({ text: '開く\t400\t300\t40\t20\tWindow\n', press: 'click' });
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();

    await expect(
      session.act({ kind: 'tap', target: { at: 'element', ref: '開く', kind: 'button' } }),
    ).rejects.toThrow(/ボタン.*Window/);
    expect(sent.some((c) => c[0] === 'press')).toBe(false);
  });
});

/** **ダブルクリック**（#42 の改善案）。本物のクリックを 2 回。**`Invoke` には落とさない**（2 回押す口が無い）。 */
describe('Windows の「ダブルクリックする」', () => {
  it('道具に dblclick を頼み、そう言う', async () => {
    says({ text: '2026/09/03\t300\t200\t90\t24\tDataItem\n', press: '' });
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();

    const report = await session.act({
      kind: 'doubleTap',
      target: { at: 'element', ref: '2026/09/03', kind: 'cell' },
    });

    expect(sent.find((c) => c[0] === 'dblclick')).toEqual(['dblclick', '4242', '300', '200']);
    expect(report === undefined ? '' : report.detail).toBe(
      '「2026/09/03」（DataItem）をダブルクリックした（300, 200）',
    );
  });
});

/**
 * **打ったあとの欄の値を、証跡に書く**（#42 の改善案・おまけ）。
 *
 * > 入力の後に、フォーカスのある欄の値（ValuePattern）を証跡へ自動で書く。
 * > 「変わらないこと」を確かめる検証でも、人が画像を拡大せずに読めるようになります。
 *
 * 道具は `種類 \t 名前 \t 値` を返す。**パスワード欄は値を返さない**（道具の側で読まない）。
 */
describe('Windows の「入力する」が言うこと', () => {
  const typed = async (keysSays: string): Promise<string> => {
    says({ text: '', press: '', keys: keysSays });
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();
    const report = await session.act({ kind: 'type', text: '20261' });
    return report === undefined ? '' : report.detail;
  };

  it('焦点の欄の種類・名前・打ったあとの値を言う', async () => {
    expect(await typed('Spinner\t年\t2026\n')).toBe(
      '焦点の欄（Spinner「年」）へ 1 文字ずつ打った。打ったあとの値: 2026',
    );
  });

  it('値が読めなければ、読めなかったと言う（黙って空にしない）', async () => {
    expect(await typed('')).toBe('焦点の欄へ 1 文字ずつ打った（打ったあとの値は読めなかった）');
  });

  it('パスワード欄なら、値は書かないと言う', async () => {
    expect(await typed('Edit\tパスワード\t\tpassword\n')).toBe(
      '焦点の欄（Edit「パスワード」）へ 1 文字ずつ打った（パスワード欄なので、値は書かない）',
    );
  });
});

/**
 * **種類で先に絞り、種類を書いたら完全一致だけ**（#42・2026-09-27 の報告 A / C）。
 *
 * > `「2025-01-01」セルをクリックする` → 「2025-01-01 10:00」（DataItem）を本物のクリックで押した
 * > …続く「Enter」キーを押すがエディタに入り、元のファイルが書き換わって保存されました。
 */
describe('Windows の種類つき — 選び方の順番', () => {
  const connect = () =>
    createWindowsDesktopAdapter({ app: 'md-business', toolPath, build, runTool }).connect();

  it('別の種類の完全一致が在っても、書いた種類の完全一致を押す', async () => {
    says({
      text: '2025-01-01\t100\t100\t60\t14\tText\n' + '2025-01-01\t300\t200\t90\t24\tDataItem\n',
      press: 'click',
    });
    const session = await connect();

    await session.act({ kind: 'tap', target: { at: 'element', ref: '2025-01-01', kind: 'cell' } });

    expect(sent.find((c) => c[0] === 'press')).toEqual(['press', '4242', '300', '200']);
  });

  it('種類を書いたのに部分一致しか無ければ、押さずに近いものを言う', async () => {
    says({ text: '2025-01-01 10:00\t300\t200\t90\t24\tDataItem\n', press: 'click' });
    const session = await connect();

    await expect(
      session.act({ kind: 'tap', target: { at: 'element', ref: '2025-01-01', kind: 'cell' } }),
    ).rejects.toThrow(/完全に一致するセルが無い.*2025-01-01 10:00/);
    expect(sent.some((c) => c[0] === 'press')).toBe(false);
  });

  /** 種類を書かなければ、今までどおり部分一致も採る（#11）。 */
  it('種類を書かなければ、部分一致も採る', async () => {
    says({ text: '2025-01-01 10:00\t300\t200\t90\t24\tDataItem\n', press: 'click' });
    const session = await connect();

    await session.act({ kind: 'tap', target: { at: 'element', ref: '2025-01-01' } });

    expect(sent.find((c) => c[0] === 'press')).toEqual(['press', '4242', '300', '200']);
  });
});

/**
 * **キーにも、何へ送ったかを付ける**（#42・報告の「そのほか」）。
 * > キーを押す手順に steps[].detail が付きません。どの窓・どの欄にキーが入ったかが証跡から分からず
 * 道具は送る直前の焦点の欄を `種類 \t 名前 \t 値` で返す。**キーの証跡には値を書かない**（名前と種類で足りる）。
 */
describe('Windows の「キーを押す」が言うこと', () => {
  it('送る直前の焦点の欄を言う', async () => {
    says({ text: '', press: '', keys: '' });
    output.key = 'Edit\tエディタ\t2025-01-01\n';
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();

    const report = await session.act({ kind: 'key', key: 'Enter' });

    expect(report === undefined ? '' : report.detail).toBe(
      'Enter を送った（焦点: Edit「エディタ」）',
    );
  });

  it('焦点が読めなければ、そう言う', async () => {
    says({ text: '', press: '' });
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();

    const report = await session.act({ kind: 'key', key: 'Enter' });

    expect(report === undefined ? '' : report.detail).toBe(
      'Enter を送った（焦点の欄は読めなかった）',
    );
  });
});

/**
 * **打ち始めた欄の値を出す。焦点が移ったら、移った先も並べる**（#42・2026-09-28 の報告）。
 *
 * > 日付欄は、年を 4 桁打つと焦点が自動で月→日へ進みます。…「年がいくつになったか」を
 * > 確かめたい手順で、年の値が証跡に残りません。
 *
 * 道具は 1 行目に**打ち始めた欄**（種類・名前・値・印・親の値）、2 行目に**移った先**を返す。
 */
describe('Windows の「入力する」— 焦点が移る欄', () => {
  const typed = async (keysSays: string): Promise<string> => {
    says({ text: '', press: '', keys: keysSays });
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();
    const report = await session.act({ kind: 'type', text: '20260903' });
    return report === undefined ? '' : report.detail;
  };

  it('打ち始めた欄の値と、欄全体の値と、移った先を言う', async () => {
    expect(await typed('Spinner\t年\t2026\t\t2026-09-03\nSpinner\t日\t03\t\n')).toBe(
      '焦点の欄（Spinner「年」）へ 1 文字ずつ打った。打ったあとの値: 2026（欄全体: 2026-09-03）。' +
        '焦点は Spinner「日」へ移った（値: 03）',
    );
  });

  it('移っていなければ、移った先は言わない', async () => {
    expect(await typed('Edit\t検索\tabc\t\t\n')).toBe(
      '焦点の欄（Edit「検索」）へ 1 文字ずつ打った。打ったあとの値: abc',
    );
  });
});

/**
 * **「欄全体」が打つ前のままなら、そう書く**（#42・2026-09-28 の報告）。
 *
 * > 画面では 2026/09/03 10:00 になっているのに、欄全体は 2025-01-01T10:00（打つ前の値）でした。
 *
 * 道具は 6 列目に `unchanged` を付ける（打つ前に読んだ値と、少し待って読み直した値が同じ）。
 * **画面と違うかもしれない値を、黙って証跡に残さない。**
 * 最初は「欄がまだ値を確定していない」と書いたが、**アプリは本文まで書き換えていた**（dev-048e9c7）。
 * 確かめていない原因を言い切らない。
 */
describe('Windows の「入力する」— 欄全体が打つ前のまま', () => {
  it('打つ前と同じなら、分かっていることだけを書く（原因は言い切らない）', async () => {
    says({ text: '', press: '', keys: 'Spinner\t年\t2026\t\t2025-01-01T10:00\tunchanged\n' });
    const session = await createWindowsDesktopAdapter({
      app: 'md-business',
      toolPath,
      build,
      runTool,
    }).connect();

    const report = await session.act({ kind: 'type', text: '20260903' });

    expect(report === undefined ? '' : report.detail).toBe(
      '焦点の欄（Spinner「年」）へ 1 文字ずつ打った。打ったあとの値: 2026' +
        '（欄全体として読める値は打つ前のまま: 2025-01-01T10:00。画面は変わっていることがある）',
    );
  });
});
