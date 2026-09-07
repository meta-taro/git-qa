import { describe, expect, it } from 'vitest';

import { explainToolFailure } from '../src/permission.js';

describe('explainToolFailure', () => {
  /**
   * **2026-09-07 に実際に踏んだ。**
   *
   * 連動くん（Electron）で「「管理」を押す」を実行したら、こう出た。
   *
   *   osascript が失敗した: 36:56: execution error: System Events でエラーが起きました:
   *   osascript には補助アクセスは許可されません。 (-25211)
   *
   * **原因は書いてあるのに、次に何をすればよいかが無い。**
   * 見ることはできて触ることだけができない、という状態も読み取れない。
   */
  it('補助アクセスが無いときは、どこで何を許可するかまで言う', () => {
    const message = explainToolFailure(
      'osascript',
      '36:56: execution error: System Eventsでエラーが起きました: ' +
        'osascriptには補助アクセスは許可されません。 (-25211)',
    );

    expect(message).toContain('アクセシビリティ');
    expect(message).toContain('システム設定');
    expect(message).toContain('ターミナル');
    // **見るのと触るのは別の許可。**そこを取り違えると、画面収録を疑いに行く。
    expect(message).toContain('画面を見ることはできている');
  });

  /**
   * **2026-09-07、この文言自体が人を間違った方へ送った。**
   *
   * 「ターミナルははなから ON ですよ」と言われて、実際その通りだった。
   * `-25211` は許可が無いときにも出るが、**相手のアプリがまだ中身を出していないときにも出る**
   * （Electron / Chromium）。**許可の話だけを書くと、合っている設定を疑わせる。**
   */
  it('許可が原因とは限らないことを、同じ文の中で言う', () => {
    const message = explainToolFailure('osascript', '… (-25211)');

    expect(message).toContain('Electron');
    expect(message).toContain('許可が入っているのに出ることがある');
  });

  it('英語で出たときも同じに扱う', () => {
    const message = explainToolFailure(
      'osascript',
      'execution error: System Events got an error: ' +
        'osascript is not allowed assistive access. (-25211)',
    );

    expect(message).toContain('アクセシビリティ');
  });

  it('心当たりの無い失敗は、出た文字をそのまま返す', () => {
    const message = explainToolFailure('screencapture', 'cannot write file');

    expect(message).toBe('screencapture が失敗した: cannot write file');
  });

  it('何も言われずに落ちたときも、道具の名前だけは残す', () => {
    expect(explainToolFailure('osascript', '')).toBe('osascript が失敗した（何も言わずに落ちた）');
  });
});
