// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { KEY_BINDINGS, commandForKey, shouldIgnoreKeyPress } from '../../src/session/keys.js';

/**
 * 人が押すキー。**1 打鍵で置いて、次へ進む**（C6）。
 *
 * Enter も修飾キーも要求しない。要求すると、見ながら押す動作が 2 手になり、
 * 「見た人がその場で置く」という前提が崩れる。
 */

describe('commandForKey', () => {
  it('d で VERIFIED を置く', () => {
    expect(commandForKey({ key: 'd' })).toEqual({ kind: 'verdict', humanResult: 'VERIFIED' });
  });

  it('f / b / s で FAIL / BLOCKED / SKIP を置く', () => {
    expect(commandForKey({ key: 'f' })).toEqual({ kind: 'verdict', humanResult: 'FAIL' });
    expect(commandForKey({ key: 'a' })).toEqual({ kind: 'verdict', humanResult: 'BLOCKED' });
    expect(commandForKey({ key: 's' })).toEqual({ kind: 'verdict', humanResult: 'SKIP' });
  });

  it('空白は、置かずに次へ送る（AUTO_PASS のまま）', () => {
    expect(commandForKey({ key: ' ' })).toEqual({ kind: 'advance' });
  });

  it('取り消し（u）はまだ割り当てない', () => {
    // **押しても何も起きないキーを作らない。**取り消しは、確定したケースを
    // コア側で開け直す仕組みが要る（Issue 004 の既知の穴）。
    expect(commandForKey({ key: 'u' })).toBeUndefined();
  });

  it('大文字でも同じ（Shift を押したまま打っても効く）', () => {
    expect(commandForKey({ key: 'D' })).toEqual({ kind: 'verdict', humanResult: 'VERIFIED' });
  });

  it('修飾キー付きは受け取らない（OS や webview の操作を奪わない）', () => {
    expect(commandForKey({ key: 'd', metaKey: true })).toBeUndefined();
    expect(commandForKey({ key: 'd', ctrlKey: true })).toBeUndefined();
    expect(commandForKey({ key: 'd', altKey: true })).toBeUndefined();
  });

  it('割り当てていないキーは何もしない', () => {
    expect(commandForKey({ key: 'x' })).toBeUndefined();
    expect(commandForKey({ key: 'Enter' })).toBeUndefined();
  });

  it('キー一覧は、実際の割り当てと同じものを出す', () => {
    // **人へ出す説明が実装とずれない**ようにする。ずれた説明は、無い説明より悪い。
    for (const binding of KEY_BINDINGS) {
      expect(commandForKey({ key: binding.key })).toBeDefined();
    }
  });
});

describe('ケースを前後に動かす（Issue 013）', () => {
  it('← / → で見ているケースを動かす', () => {
    expect(commandForKey({ key: 'ArrowLeft' })).toEqual({ kind: 'prev' });
    expect(commandForKey({ key: 'ArrowRight' })).toEqual({ kind: 'next' });
  });

  it('↑ / ↓ でも動かせる（一覧は縦に並んでいる）', () => {
    expect(commandForKey({ key: 'ArrowUp' })).toEqual({ kind: 'prev' });
    expect(commandForKey({ key: 'ArrowDown' })).toEqual({ kind: 'next' });
  });

  it('修飾キー付きは受け取らない（OS の操作を奪わない）', () => {
    expect(commandForKey({ key: 'ArrowLeft', metaKey: true })).toBeUndefined();
  });
});

describe('shouldIgnoreKeyPress — 文字を打っている最中は判定に取られない', () => {
  /**
   * **端末へ文字を送る欄に打った `v` が、判定になってはいけない。**
   * 入力の中の打鍵は、判定として扱わない。
   */
  it('入力欄の中では無視する', () => {
    const input = document.createElement('input');
    expect(shouldIgnoreKeyPress(input)).toBe(true);

    const area = document.createElement('textarea');
    expect(shouldIgnoreKeyPress(area)).toBe(true);
  });

  it('ボタンの上では無視する（Space で二重に効かないように）', () => {
    expect(shouldIgnoreKeyPress(document.createElement('button'))).toBe(true);
  });

  it('画面のどこでもない所は、判定として扱う', () => {
    expect(shouldIgnoreKeyPress(document.createElement('div'))).toBe(false);
    expect(shouldIgnoreKeyPress(null)).toBe(false);
  });
});

/**
 * **意味が反転するキーを作らない。**
 *
 * 2026-09-04、左手をホーム段に置いたまま操作する前提で A S D F へ寄せた。
 * そのとき `f` を合格にすると「不合格 → 合格」の反転になる。**この製品でいちばん
 * 壊してはいけない値なので採らなかった。**外れた `v` / `b` は、押しても何も起きない。
 */
describe('左手ホーム段への割り当て', () => {
  it('f の意味は不合格のまま', () => {
    expect(commandForKey({ key: 'f' })).toEqual({ kind: 'verdict', humanResult: 'FAIL' });
  });

  it('s の意味は「今回は見ない」のまま', () => {
    expect(commandForKey({ key: 's' })).toEqual({ kind: 'verdict', humanResult: 'SKIP' });
  });

  it('外れた v と b は、押しても何も起きない', () => {
    expect(commandForKey({ key: 'v' })).toBeUndefined();
    expect(commandForKey({ key: 'b' })).toBeUndefined();
  });

  /**
   * **判定の割り当ては A S D F と Space だけ**（右手を要求しない）。
   *
   * 2026-09-14 に言い方を直した。前は「すべての割り当て」を数えていたが、
   * **矢印（見る場所を動かす）と拡大（映像を寄せる）は判定ではない。**
   * 右手で押しても、**左手をホーム段に置いたまま判定できる**ことは変わらない。
   *
   * **緩めたのではなく、何を守っているのかを言い直した。**
   * 判定のキーが増えたり右手へ移ったりしたら、ここで落ちる。
   */
  it('判定の割り当ては A S D F と Space だけ（右手を要求しない）', () => {
    const verdictKeys = KEY_BINDINGS.map((binding) => binding.key).filter((key) => {
      const command = commandForKey({ key });
      return command?.kind === 'verdict' || command?.kind === 'advance';
    });

    expect(new Set(verdictKeys)).toEqual(new Set(['a', 's', 'd', 'f', ' ']));
  });

  /** **拡大は判定ではない。**押しても証跡は変わらない。 */
  it('拡大のキーは判定にならない', () => {
    for (const key of ['+', '-', '0']) {
      expect(commandForKey({ key })?.kind).toBe('zoom');
    }
  });
});

/**
 * **鑑賞を止める**（2026-09-11・人の指示）。
 *
 * > 途中で止められる配慮も必要です。
 *
 * 鑑賞モードは押さなくても進む。**止めたいときに止められないのは、
 * 見ているだけより悪い。**
 */
describe('commandForKey — 止める', () => {
  it('Esc で止まる', () => {
    expect(commandForKey({ key: 'Escape' })).toEqual({ kind: 'stop' });
  });

  /** **判定のキーは奪わない。**止めるのは、判定とは別の手。 */
  it('判定のキーは今までどおり', () => {
    expect(commandForKey({ key: 'd' })).toEqual({ kind: 'verdict', humanResult: 'VERIFIED' });
  });

  /** 修飾キー付きは受け取らない（ほかと同じ）。**⌘Esc を奪わない。** */
  it('修飾キー付きの Esc は受け取らない', () => {
    expect(commandForKey({ key: 'Escape', metaKey: true })).toBeUndefined();
  });
});

/**
 * **見えない画面で判定させない**（外部レビュー meta-taro/git-qa#13）。
 *
 * > 相手の状態表示は 12〜13px で描かれているので、59% では **7px 前後**になります。
 *
 * 拡大の割り当ては、**判定のキー（D/F/A/S）を奪わない**こと。
 */
describe('commandForKey — 拡大', () => {
  it('+ で寄る', () => {
    expect(commandForKey({ key: '+' })).toEqual({ kind: 'zoom', by: 1 });
    // テンキーでない `+` は Shift を伴う。**押し直させない。**
    expect(commandForKey({ key: ';' })).toBeUndefined();
  });

  it('- で引く', () => {
    expect(commandForKey({ key: '-' })).toEqual({ kind: 'zoom', by: -1 });
  });

  it('0 で戻す', () => {
    expect(commandForKey({ key: '0' })).toEqual({ kind: 'zoom', by: 0 });
  });

  /** **判定のキーは奪わない。** */
  it('判定のキーは今までどおり', () => {
    expect(commandForKey({ key: 'd' })).toEqual({ kind: 'verdict', humanResult: 'VERIFIED' });
    expect(commandForKey({ key: 'f' })).toEqual({ kind: 'verdict', humanResult: 'FAIL' });
  });
});
