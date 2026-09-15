// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { renderColumns } from '../../src/render.js';
import { renderSession } from '../../src/session/view.js';
import type { SessionState } from '@git-qa/core/session';

/**
 * **判定する人が、何を確かめているのか読めるようにする**（外部レビュー meta-taro/git-qa#19）。
 *
 * > 人は、AI の判定範囲よりも、どう操作する。と、それをすることの意図が読みたいので。
 * > 「AI はここまでしかできません」という文章を読んでも、
 * > **は？ この検証の意味が分からないけど**
 *
 * **順番が逆だった。**人が主で、AI の但し書きは脇。
 * 見えているのに意図が読めないなら、置かれる `VERIFIED` は
 * **「AI がそう言っているから」に近づく**（#13 の追認と同じ形）。
 */
const stateWith = (fields: { label: string; value: string }[]): SessionState => ({
  runId: '20260915-120000',
  phase: 'waiting',
  awaiting: 1,
  cases: [
    {
      no: 1,
      title: 'ボタンを押すと反応する',
      aiResult: 'PASS',
      note: '画面の文字に「直前のクエリ」が在ることだけを見た',
      fields,
    },
  ],
});

describe('判定カラム — シートの中身', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.append(root);
    renderColumns(root);
  });

  it('手順と期待結果を、書いた人の言葉のまま出す', () => {
    renderSession(
      root,
      stateWith([
        { label: '手順', value: '「実行」をクリックする' },
        { label: '期待結果', value: '結果の表が出る' },
      ]),
    );

    const shown = [...root.querySelectorAll('.verdict-field')].map((el) => el.textContent ?? '');
    expect(shown[0]).toContain('手順');
    expect(shown[0]).toContain('「実行」をクリックする');
    expect(shown[1]).toContain('期待結果');
  });

  /** **書き手が足した列も出る**（提案 3）。画面が列名を知っている必要は無い。 */
  it('知らない列も出す', () => {
    renderSession(root, stateWith([{ label: 'なぜ見るのか', value: '対照のため' }]));

    expect(root.querySelector('.verdict-field')?.textContent).toContain('なぜ見るのか');
  });

  /**
   * **人が主で、AI の但し書きは脇**（#19）。
   * いまは AI の文がいちばん目立つ所に在り、手順は画面に無かった。
   */
  it('手順は、AI の判定より上に出る', () => {
    renderSession(root, stateWith([{ label: '手順', value: '押す' }]));

    const body = root.querySelector('[data-column-id="verdict"]');
    const order = [...(body?.querySelectorAll('.verdict-field, .verdict-ai') ?? [])].map(
      (el) => el.className,
    );

    expect(order[0]).toBe('verdict-field');
    expect(order).toContain('verdict-ai');
  });

  /** **但し書きは畳んでおく**（提案 2）。必要な人は開ける。 */
  it('AI の但し書きは畳んである', () => {
    renderSession(root, stateWith([{ label: '手順', value: '押す' }]));

    const details = root.querySelector('details.verdict-ai-detail');
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement | null)?.open).toBe(false);
    expect(details?.textContent).toContain('直前のクエリ');
  });

  /** 欄を持たないシート（前の版の実行）でも、今までどおり出る。 */
  it('欄が無くても、判定は置ける', () => {
    const state = stateWith([]);
    renderSession(root, { ...state, cases: [{ no: 1, title: 'ボタン', aiResult: 'PASS' }] });

    expect(root.querySelector('.verdict-headline')?.textContent).toContain('ボタン');
    expect(root.querySelectorAll('.verdict-field')).toHaveLength(0);
  });
});
