import { describe, expect, it } from 'vitest';

import {
  boundsCenter,
  escapeInputText,
  findElementCenter,
  inputCommands,
  keycode,
  parseDeviceList,
  screenText,
  withSerial,
} from '../src/index.js';

const DUMP = `<?xml version='1.0' encoding='UTF-8'?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="com.example:id/root" class="android.widget.FrameLayout" content-desc="" bounds="[0,0][1080,2220]">
    <node index="0" text="保存" resource-id="com.example:id/save" class="android.widget.Button" content-desc="保存ボタン" bounds="[100,200][300,280]" />
    <node index="1" text="キャンセル" resource-id="" class="android.widget.Button" content-desc="" bounds="[400,200][600,280]" />
  </node>
</hierarchy>`;

describe('parseDeviceList', () => {
  it('見出しと空行を落として、serial と状態を返す', () => {
    const out = 'List of devices attached\nemulator-5554\tdevice\nR3CN90ABCDE\toffline\n\n';
    expect(parseDeviceList(out)).toEqual([
      { serial: 'emulator-5554', state: 'device' },
      { serial: 'R3CN90ABCDE', state: 'offline' },
    ]);
  });

  it('device 以外の状態も落とさずに残す', () => {
    // 捨てると「繋がらない理由」が消える。unauthorized は人が端末で許可すれば直る。
    const out = 'List of devices attached\nR3CN90ABCDE\tunauthorized\n';
    expect(parseDeviceList(out)[0]?.state).toBe('unauthorized');
  });

  it('1 台も無いときは空', () => {
    expect(parseDeviceList('List of devices attached\n\n')).toEqual([]);
  });
});

describe('withSerial', () => {
  it('serial があれば -s を前置きする', () => {
    expect(withSerial('emulator-5554', ['shell', 'x'])).toEqual([
      '-s',
      'emulator-5554',
      'shell',
      'x',
    ]);
  });

  it('serial が無ければ何も足さない', () => {
    expect(withSerial(undefined, ['devices'])).toEqual(['devices']);
  });
});

describe('escapeInputText', () => {
  it('空白は %s になる（input text の仕様）', () => {
    expect(escapeInputText('hello world')).toBe('hello%sworld');
  });

  it('端末側の sh に解釈される文字を escape する', () => {
    // adb は引数を空白で繋いで端末の sh へ渡すので、こちらでクォートしても効かない。
    expect(escapeInputText('a&b|c;d')).toBe('a\\&b\\|c\\;d');
    expect(escapeInputText('$(whoami)')).toBe('\\$\\(whoami\\)');
  });

  it('非 ASCII は黙って化けさせず、落とす', () => {
    expect(() => escapeInputText('こんにちは')).toThrow(/input text で送れない/);
  });
});

describe('keycode', () => {
  it('短い呼び名を KEYCODE_ へ寄せる', () => {
    expect(keycode('back')).toBe('KEYCODE_BACK');
  });

  it('既に KEYCODE_ ならそのまま', () => {
    expect(keycode('KEYCODE_DPAD_DOWN')).toBe('KEYCODE_DPAD_DOWN');
  });
});

describe('inputCommands', () => {
  it('tap は 1 本', () => {
    expect(inputCommands({ kind: 'tap', at: { x: 10, y: 20 } })).toEqual([
      ['shell', 'input', 'tap', '10', '20'],
    ]);
  });

  it('swipe は所要時間まで渡す', () => {
    expect(
      inputCommands({
        kind: 'swipe',
        from: { x: 1, y: 2 },
        to: { x: 3, y: 4 },
        durationMs: 250,
      }),
    ).toEqual([['shell', 'input', 'swipe', '1', '2', '3', '4', '250']]);
  });

  it('入力欄を指定した type は、選んでから打つ 2 本になる', () => {
    expect(inputCommands({ kind: 'type', text: 'ab', at: { x: 5, y: 6 } })).toEqual([
      ['shell', 'input', 'tap', '5', '6'],
      ['shell', 'input', 'text', 'ab'],
    ]);
  });

  it('入力欄を指定しない type は 1 本', () => {
    expect(inputCommands({ kind: 'type', text: 'ab' })).toEqual([['shell', 'input', 'text', 'ab']]);
  });
});

describe('boundsCenter', () => {
  it('中心を出す', () => {
    expect(boundsCenter('[100,200][300,280]')).toEqual({ x: 200, y: 240 });
  });

  it('読めない形なら undefined', () => {
    expect(boundsCenter('100,200')).toBeUndefined();
  });
});

describe('findElementCenter', () => {
  it('resource-id で引ける', () => {
    expect(findElementCenter(DUMP, 'com.example:id/save')).toEqual({ x: 200, y: 240 });
  });

  it('text で引ける', () => {
    expect(findElementCenter(DUMP, 'キャンセル')).toEqual({ x: 500, y: 240 });
  });

  it('content-desc で引ける', () => {
    expect(findElementCenter(DUMP, '保存ボタン')).toEqual({ x: 200, y: 240 });
  });

  it('部分一致では引かない', () => {
    // 部分一致にすると、画面が変わったときに別の要素を掴んで、しかも気づけない。
    expect(findElementCenter(DUMP, '保存ボ')).toBeUndefined();
  });

  it('空文字で全部に当たったりしない', () => {
    // resource-id が空のノードがあるので、空文字を許すと最初の 1 つを掴んでしまう。
    expect(findElementCenter(DUMP, '')).toBeUndefined();
  });

  it('見つからなければ undefined', () => {
    expect(findElementCenter(DUMP, 'com.example:id/nope')).toBeUndefined();
  });
});

describe('screenText — 画面から読める文字を集める', () => {
  const xml = [
    '<hierarchy>',
    '<node text="メモ一覧" content-desc="" resource-id="jp.example:id/title" bounds="[0,0][100,50]" />',
    '<node text="" content-desc="追加" resource-id="jp.example:id/add" bounds="[0,60][100,110]" />',
    '<node text="保存しました" content-desc="" bounds="[0,120][100,170]" />',
    '</hierarchy>',
  ].join('\n');

  it('text と content-desc を拾う', () => {
    const text = screenText(xml);

    expect(text).toContain('メモ一覧');
    expect(text).toContain('追加');
    expect(text).toContain('保存しました');
  });

  it('空の値は入れない（空行だけが並ばないように）', () => {
    expect(
      screenText(xml)
        .split('\n')
        .filter((line) => line === ''),
    ).toHaveLength(0);
  });

  it('実体参照を戻す（そのままだと期待結果と突き合わない）', () => {
    expect(screenText('<node text="A &amp; B &lt;C&gt;" />')).toBe('A & B <C>');
  });

  it('要素が無ければ空', () => {
    expect(screenText('<hierarchy></hierarchy>')).toBe('');
  });
});
