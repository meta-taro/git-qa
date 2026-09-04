import { describe, expect, it } from 'vitest';

import { AdapterError, humanMessage } from '../../src/index.js';

/**
 * **人が読む文に、内部の印を出さない。**
 *
 * 実物を使った人が画面で見た文（2026-09-04）:
 *
 * > ライブ映像を出せない: [android] screenrecord が映像を 1 枚も返さずに終わった
 *
 * `[android]` は、複数の相手に繋ぐときログで切り分けるために付けている。
 * **ログには要るが、画面では読む人の邪魔にしかならない。**
 */
describe('humanMessage', () => {
  it('先頭の [対象] を落とす', () => {
    expect(humanMessage(new AdapterError('android', '端末の画面が消えている'))).toBe(
      '端末の画面が消えている',
    );
  });

  it('印の無いエラーはそのまま', () => {
    expect(humanMessage(new Error('証跡を書けない'))).toBe('証跡を書けない');
  });

  it('文の途中の [ ] は落とさない（本文を削らない）', () => {
    expect(humanMessage(new Error('画面に見つからない要素: [保存]'))).toBe(
      '画面に見つからない要素: [保存]',
    );
  });

  it('エラーでないものも文にする（握り潰さない）', () => {
    expect(humanMessage('繋がらない')).toBe('繋がらない');
  });
});
