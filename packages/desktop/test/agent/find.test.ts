// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { findTarget, namesOf, whyRefused } from '../../src/agent/find.js';

/**
 * 画面の言葉で、指す相手を探す（C120）。座標は使わない。
 */

beforeEach(() => {
  document.body.replaceChildren();
});

const html = (markup: string): void => {
  document.body.innerHTML = markup;
};
const always = (): boolean => true;

describe('findTarget', () => {
  it('ぴったり同じ名前を先に、無ければ始まる名前、無ければ含む名前（画面の上から）', () => {
    html(`
      <button id="a">始める（続きから）</button>
      <button id="b">始める</button>
      <button id="c">やめて始める</button>
    `);

    expect(findTarget(document, '始める', always)?.id).toBe('b');
    expect(findTarget(document, '始める（', always)?.id).toBe('a');
    expect(findTarget(document, 'やめて', always)?.id).toBe('c');
    expect(findTarget(document, '止める', always)).toBeUndefined();
  });

  it('入力欄は、欄の見出し（label）・placeholder・aria-label・title でも指せる', () => {
    html(`
      <label for="url">2. 見るウェブページ</label><input id="url" placeholder="https://" />
      <input id="q" aria-label="検索" />
      <button id="t" title="フォルダを開く">📁</button>
    `);

    expect(findTarget(document, '見るウェブページ', always)?.id).toBe('url');
    expect(findTarget(document, 'https://', always)?.id).toBe('url');
    expect(findTarget(document, '検索', always)?.id).toBe('q');
    expect(findTarget(document, 'フォルダを開く', always)?.id).toBe('t');
  });

  it('見えていないものは探さない（隠れた要素を押させない）', () => {
    html(`<button id="hidden">始める</button><button id="shown">始める</button>`);

    const found = findTarget(document, '始める', (el) => el.id !== 'hidden');

    expect(found?.id).toBe('shown');
  });

  it('空白の違いは無視する（改行や詰めの差で見つからないことにしない）', () => {
    html(`<h2>ライブ\n  ビュー</h2>`);

    expect(findTarget(document, 'ライブ ビュー', always)?.tagName).toBe('H2');
  });

  it('空の言葉では何も指さない', () => {
    html(`<button>始める</button>`);

    expect(findTarget(document, '   ', always)).toBeUndefined();
  });
});

describe('namesOf', () => {
  it('呼び名を、空白を詰めて並べる', () => {
    html(`<button title=" 開く ">  フォルダを\n開く </button>`);

    expect(namesOf(document.querySelector('button') as HTMLElement)).toEqual([
      '開く',
      'フォルダを 開く',
    ]);
  });
});

/**
 * **エージェントが触ってはいけない所**（C1 / C17）。
 * 判定のキーは「人が見た」を証跡に残す。ハンドルは「誰が」。どちらも人だけが置く。
 */
describe('whyRefused', () => {
  it('判定のキー（.key-action）は、押せない。指すのは構わない', () => {
    html(
      `<button class="key-action" data-key="d"><span class="key-label">合格にする</span></button>`,
    );
    const label = document.querySelector('.key-label') as HTMLElement;

    expect(whyRefused(label, 'click')).toBe('verdict');
    expect(whyRefused(label, 'type')).toBe('verdict');
    expect(whyRefused(label, 'point')).toBeUndefined();
  });

  it('ハンドルの欄（.setup-operator）には、打てない。指す・押す（フォーカス）は構わない', () => {
    html(`<input class="setup-operator" />`);
    const field = document.querySelector('input') as HTMLElement;

    expect(whyRefused(field, 'type')).toBe('handle');
    expect(whyRefused(field, 'click')).toBeUndefined();
    expect(whyRefused(field, 'point')).toBeUndefined();
  });

  it('それ以外は触れる', () => {
    html(`<button id="go">始める</button><input id="url" />`);

    expect(whyRefused(document.getElementById('go') as HTMLElement, 'click')).toBeUndefined();
    expect(whyRefused(document.getElementById('url') as HTMLElement, 'type')).toBeUndefined();
  });
});

/**
 * **実物の画面で踏んだ**（2026-11-12）。「0. あなたのハンドル」は `<p>` の見出しで、欄に label が無い。
 * 見出しの言葉で指したら、すぐ後ろの欄を指したことにする。
 */
describe('findTarget — 見出しの言葉で欄を指す', () => {
  it('<p> の見出しのすぐ後ろの欄に解決する', () => {
    html(
      `<p class="setup-section-label">0. あなたのハンドル（証跡に残る）</p><input id="handle" class="setup-operator" />`,
    );

    expect(findTarget(document, 'あなたのハンドル', always)?.id).toBe('handle');
  });

  it('見出しの後ろが欄でなければ、見出しそのものを指す（文を指して説明できる）', () => {
    html(`<p id="note">1. 見る相手を選ぶ</p><div>…</div>`);

    expect(findTarget(document, '見る相手を選ぶ', always)?.id).toBe('note');
  });

  it('札（span）の文字でも指せる', () => {
    html(`<div><span id="chip">これを見る</span></div>`);

    expect(findTarget(document, 'これを見る', always)?.id).toBe('chip');
  });
});
