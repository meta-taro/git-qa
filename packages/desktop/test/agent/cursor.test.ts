// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentCursor } from '../../src/agent/cursor.js';
import { createTranslator } from '../../src/i18n/locale.js';

/**
 * エージェントの専用カーソル（C120）。
 *
 * 人のマウスは使わない。**判定のキーは押さない。ハンドルは打たない**（C1 / C17）。
 * 組み版はここでは見ない（置き場所の数は `placement.test.ts`、実物は人が目で見る）。
 */

const t = createTranslator('ja');

beforeEach(() => {
  document.body.replaceChildren();
});

const cursor = () =>
  createAgentCursor({
    doc: document,
    win: window,
    t,
    isVisible: () => true,
    wait: () => Promise.resolve(),
  });

const el = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`${selector} が無い`);
  return found;
};

describe('createAgentCursor', () => {
  it('point で、カーソルと枠が出て、吹き出しに一言が載る', async () => {
    document.body.innerHTML = `<button id="go">始める</button>`;

    await cursor().run({ action: 'point', target: '始める', message: 'ここを押します' });

    expect(el('.agent-cursor').hidden).toBe(false);
    expect(el('.agent-cursor .agent-cursor-tag').textContent).toBe('エージェント');
    expect(el('.agent-frame').hidden).toBe(false);
    expect(el('.agent-bubble').hidden).toBe(false);
    expect(el('.agent-bubble-text').textContent).toBe('ここを押します');
    // 人のクリックを邪魔しない目印（CSS の pointer-events: none はここでは見えない）。
    expect(el('.agent-cursor').getAttribute('aria-hidden')).toBe('true');
  });

  it('click で、その要素が押される（人のマウスは動かさない：ページの中のイベントだけ）', async () => {
    document.body.innerHTML = `<button id="go">始める</button>`;
    const pressed = vi.fn();
    const down = vi.fn();
    el('#go').addEventListener('click', pressed);
    el('#go').addEventListener('mousedown', down);

    await cursor().run({ action: 'click', target: '始める' });

    expect(down).toHaveBeenCalledTimes(1);
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(el('.agent-cursor').classList.contains('click')).toBe(true);
  });

  it('type で、欄に文字が入り、input と change が飛ぶ', async () => {
    document.body.innerHTML = `<label for="url">2. 見るウェブページ</label><input id="url" />`;
    const changed = vi.fn();
    const typed = vi.fn();
    el('#url').addEventListener('input', typed);
    el('#url').addEventListener('change', changed);

    await cursor().run({ action: 'type', target: '見るウェブページ', value: 'http://a' });

    expect(el<HTMLInputElement>('#url').value).toBe('http://a');
    expect(typed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('見つからない target では、何も押さず、「見つかりません」を札に出す', async () => {
    document.body.innerHTML = `<button id="go">始める</button>`;
    const pressed = vi.fn();
    el('#go').addEventListener('click', pressed);

    await cursor().run({ action: 'click', target: '止める' });

    expect(pressed).not.toHaveBeenCalled();
    expect(el('.agent-cursor-tag').textContent).toBe('「止める」が画面に見つかりません');
    expect(el('.agent-frame').hidden).toBe(true);
  });

  /**
   * **判定は人が置く**（C1 / C17）。`click` で合格のキーを指しても、押さない。
   * 指して見せ、理由を吹き出しで人にも出す（黙って無視しない）。
   */
  it('判定のキーは、指すが押さない。理由を吹き出しに出す', async () => {
    document.body.innerHTML = `<button class="key-action" data-key="d"><span class="key-label">合格にする</span></button>`;
    const pressed = vi.fn();
    el('.key-action').addEventListener('click', pressed);

    await cursor().run({ action: 'click', target: '合格にする', message: '押します' });

    expect(pressed).not.toHaveBeenCalled();
    expect(el('.agent-frame').hidden).toBe(false);
    expect(el('.agent-bubble-text').textContent).toBe(
      '判定は人が置くもの。エージェントは押しません',
    );
  });

  it('ハンドルの欄には、打たない。理由を吹き出しに出す', async () => {
    document.body.innerHTML = `<input class="setup-operator" aria-label="あなたのハンドル" />`;

    await cursor().run({ action: 'type', target: 'あなたのハンドル', value: 'bot' });

    expect(el<HTMLInputElement>('.setup-operator').value).toBe('');
    expect(el('.agent-bubble-text').textContent).toBe(
      'ハンドルは人が打つもの。エージェントは打ちません',
    );
  });

  it('say で、札に一言が載る（指す相手は要らない）', async () => {
    await cursor().run({ action: 'say', message: '次はウェブの URL です' });

    expect(el('.agent-cursor').hidden).toBe(false);
    expect(el('.agent-cursor-tag').textContent).toBe('次はウェブの URL です');
  });

  it('go で、画面の中の場所（#id）へ寄せて指す。無ければ見つからないと出す', async () => {
    document.body.innerHTML = `<section id="verdict"><h2>判定</h2></section>`;
    const c = cursor();

    await c.run({ action: 'go', hash: '#verdict' });
    expect(el('.agent-frame').hidden).toBe(false);

    await c.run({ action: 'go', hash: '#nowhere' });
    expect(el('.agent-cursor-tag').textContent).toBe('「#nowhere」が画面に見つかりません');
  });

  it('吹き出しを押すと消える', async () => {
    document.body.innerHTML = `<button>始める</button>`;
    await cursor().run({ action: 'point', target: '始める', message: 'ここ' });

    el('.agent-bubble').click();

    expect(el('.agent-bubble').hidden).toBe(true);
    expect(el('.agent-frame').hidden).toBe(true);
  });

  it('カーソル・枠・吹き出しは 1 組だけ作る（指すたびに増えない）', async () => {
    document.body.innerHTML = `<button>始める</button>`;
    const c = cursor();

    await c.run({ action: 'point', target: '始める' });
    await c.run({ action: 'point', target: '始める' });

    expect(document.querySelectorAll('.agent-cursor')).toHaveLength(1);
    expect(document.querySelectorAll('.agent-bubble')).toHaveLength(1);
  });
});

/**
 * **文字を指して「押した」ことにしない**（2026-11-12・実物の画面で、見出しを押して何も起きなかった）。
 */
describe('createAgentCursor — 押せない物・打てない欄', () => {
  it('札の文字を click すると、その札のボタンが押される', async () => {
    document.body.innerHTML = `<button id="see"><span class="pick-name">これを見る</span></button>`;
    const pressed = vi.fn();
    el('#see').addEventListener('click', pressed);

    await cursor().run({ action: 'click', target: 'これを見る' });

    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it('ただの文字（見出し）を click しても押さず、押せる物でないと吹き出しに出す', async () => {
    document.body.innerHTML = `<h3>デスクトップアプリ</h3>`;

    await cursor().run({
      action: 'click',
      target: 'デスクトップアプリ',
      message: '切り替えました',
    });

    expect(el('.agent-bubble-text').textContent).toBe(
      '「デスクトップアプリ」は押せる物ではありません（文字です）',
    );
    expect(el('.agent-cursor').classList.contains('click')).toBe(false);
  });

  it('欄でない所に type しても何も入れず、打てる欄でないと吹き出しに出す', async () => {
    document.body.innerHTML = `<p>1. 見る相手を選ぶ</p><div>…</div>`;

    await cursor().run({ action: 'type', target: '見る相手を選ぶ', value: 'x' });

    expect(el('.agent-bubble-text').textContent).toBe('「見る相手を選ぶ」は打てる欄ではありません');
  });
});
