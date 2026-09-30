import { describe, expect, it } from 'vitest';

import {
  NO_SCREEN_RECORDING,
  SCREEN_RECORDING_PREFLIGHT,
  explainToolFailure,
  parseScreenRecordingPreflight,
} from '../src/permission.js';

describe('explainToolFailure', () => {
  /**
   * **2026-09-07 に実際に踏んだ。**
   *
   * Electron で作られたデスクトップアプリで「「管理」を押す」を実行したら、こう出た。
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
   * 人から、ターミナルの許可は最初から ON だと指摘され、実際その通りだった。
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

/**
 * **画面収録の許可が無いときは、そう言って止まる**（meta-taro/git-qa#33・2026-09-30 の報告）。
 *
 * 配布版を入れ替えると、画面収録の許可が外れる。そのとき git-qa は「映像が切れました・繋ぎ直します」を
 * 繰り返すだけで、**許可が無いことが分からなかった。**配布版を入れ替えるたびに、人がここを踏む。
 */
describe('画面収録の許可', () => {
  it('macOS に聞く（CGPreflightScreenCaptureAccess）', () => {
    expect(SCREEN_RECORDING_PREFLIGHT).toContain('CGPreflightScreenCaptureAccess');
  });

  it('答えを読む。**読めなければ「分からない」**（分からないときは止めない）', () => {
    expect(parseScreenRecordingPreflight('true\n')).toBe(true);
    expect(parseScreenRecordingPreflight('false\n')).toBe(false);
    expect(parseScreenRecordingPreflight('')).toBeUndefined();
    expect(parseScreenRecordingPreflight('execution error')).toBeUndefined();
  });

  it('無いときは、無いことと、どこで入れるかを言う', () => {
    expect(NO_SCREEN_RECORDING).toContain('画面収録の許可が無い');
    expect(NO_SCREEN_RECORDING).toContain('プライバシーとセキュリティ');
    expect(NO_SCREEN_RECORDING).toContain('起動し直す');
  });
});
