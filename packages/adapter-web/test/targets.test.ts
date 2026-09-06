import { describe, expect, it } from 'vitest';

import { httpOriginFromWs, pickPageTarget } from '../src/launch.js';

/**
 * 起こしたブラウザの中から、**人が見る 1 枚**を選ぶ。
 *
 * ブラウザは画面のほかに、拡張・裏方・開発者ツールも「対象」として並べてくる。
 * **そこを掴むと、真っ白な絵が返る。**
 */

describe('httpOriginFromWs', () => {
  it('繋ぎ先から、一覧を聞く先を作る', () => {
    expect(httpOriginFromWs('ws://127.0.0.1:52341/devtools/browser/abc')).toBe(
      'http://127.0.0.1:52341',
    );
  });

  it('読めない繋ぎ先なら undefined（当て推量で聞きに行かない）', () => {
    expect(httpOriginFromWs('なんだこれ')).toBeUndefined();
  });
});

describe('pickPageTarget', () => {
  const page = {
    type: 'page',
    url: 'about:blank',
    webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/P1',
  };

  it('画面を選ぶ', () => {
    expect(pickPageTarget([page])).toBe('ws://127.0.0.1:1/devtools/page/P1');
  });

  it('画面でないものは選ばない（拡張・裏方を掴むと真っ白になる）', () => {
    const others = [
      { type: 'service_worker', url: '', webSocketDebuggerUrl: 'ws://x/1' },
      { type: 'background_page', url: '', webSocketDebuggerUrl: 'ws://x/2' },
      page,
    ];

    expect(pickPageTarget(others)).toBe('ws://127.0.0.1:1/devtools/page/P1');
  });

  it('開発者ツールの画面は選ばない', () => {
    const devtools = {
      type: 'page',
      url: 'devtools://devtools/bundled/devtools_app.html',
      webSocketDebuggerUrl: 'ws://x/3',
    };

    expect(pickPageTarget([devtools, page])).toBe('ws://127.0.0.1:1/devtools/page/P1');
  });

  it('1 枚も無ければ undefined（黙って空を返さない側で判断させる）', () => {
    expect(pickPageTarget([])).toBeUndefined();
    expect(pickPageTarget([{ type: 'page', url: 'about:blank' }])).toBeUndefined();
  });
});
