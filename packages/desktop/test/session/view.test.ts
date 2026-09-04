// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionState } from '@git-qa/core/session';

import { renderColumns } from '../../src/render.js';
import { installVerdictButtons, renderSession, showSessionError } from '../../src/session/view.js';

/**
 * 左にケース、右に判定。**中央は映像のまま触らない**（主媒体・C4）。
 */

const state: SessionState = {
  runId: '20260902-150000',
  phase: 'waiting',
  awaiting: 2,
  cases: [
    {
      no: 1,
      title: 'アプリが起動する',
      aiResult: 'BLOCKED',
      result: 'VERIFIED',
      verifiedBy: 'octocat',
    },
    {
      no: 2,
      title: 'メモを保存できる',
      aiResult: 'PASS',
      note: '画面の文字に「保存しました」が在ることだけを見た',
    },
    { no: 3, title: '空のメモは保存できない' },
  ],
};

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  renderColumns(root);
});

const column = (id: string): HTMLElement =>
  root.querySelector<HTMLElement>(`[data-column-id="${id}"]`)!;

describe('renderSession', () => {
  it('左のカラムにケースが番号順に並ぶ', () => {
    renderSession(root, state);

    const items = [...column('cases').querySelectorAll('.case-item')];
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('アプリが起動する');
    expect(items[2]?.textContent).toContain('空のメモは保存できない');
  });

  it('人の打鍵を待っているケースが、どれか分かる', () => {
    renderSession(root, state);

    const awaiting = column('cases').querySelectorAll('.case-item[aria-current="true"]');
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0]?.textContent).toContain('メモを保存できる');
  });

  it('人が置いた結果と、AI だけの結果を、別の表示にする（C1）', () => {
    renderSession(root, state);

    const items = [...column('cases').querySelectorAll<HTMLElement>('.case-item')];
    expect(items[0]?.dataset['result']).toBe('VERIFIED');
    expect(items[0]?.textContent).toContain('octocat');
    // まだ確定していないケースは、結果を持たない。**空欄は空欄のまま出す**（§19）。
    expect(items[1]?.dataset['result']).toBeUndefined();
  });

  it('右のカラムに、待っているケースの AI 判定と根拠が出る', () => {
    renderSession(root, state);

    const text = column('verdict').textContent ?? '';
    expect(text).toContain('メモを保存できる');
    expect(text).toContain('PASS');
    expect(text).toContain('画面の文字に「保存しました」が在ることだけを見た');
  });

  it('右のカラムに、押すキーの一覧が出る', () => {
    renderSession(root, state);

    const keys = [...column('verdict').querySelectorAll('.key-binding')];
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(column('verdict').textContent).toContain('VERIFIED');
  });

  it('中央のライブビューには触らない', () => {
    const live = column('live');
    const before = live.innerHTML;

    renderSession(root, state);

    expect(live.innerHTML).toBe(before);
  });

  it('描き直しても増えない', () => {
    renderSession(root, state);
    renderSession(root, state);

    expect(column('cases').querySelectorAll('.case-item')).toHaveLength(3);
  });

  it('打鍵が届かなかった理由を、右のカラムに出す', () => {
    renderSession(root, state);
    showSessionError(root, '打鍵を送れなかった: 400');
    showSessionError(root, '打鍵を送れなかった: 500');

    const errors = column('verdict').querySelectorAll('.session-error');
    // 積み上げない。**古い理由が残ると、いまの状態が読めない。**
    expect(errors).toHaveLength(1);
    expect(errors[0]?.textContent).toContain('500');
  });

  it('実行が終わったら、待っているケースは無い', () => {
    const { awaiting: _awaiting, ...rest } = state;
    renderSession(root, { ...rest, phase: 'finished' });

    expect(column('cases').querySelectorAll('.case-item[aria-current="true"]')).toHaveLength(0);
    expect(column('verdict').textContent).toContain('終了');
  });
});

describe('判定はクリックでも置ける', () => {
  /**
   * **打鍵だけにしない。**初めて触る人は、どのキーが何をするか知らない。
   * 見えているものを押せるほうが早い。
   */
  it('キーの一覧が、押せるボタンとして出る', () => {
    renderSession(root, state);

    const buttons = root.querySelectorAll<HTMLButtonElement>('.key-action');
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    expect([...buttons].map((b) => b.dataset['key'])).toContain('d');
  });

  it('押すと、同じ打鍵として扱われる', () => {
    const pressed: string[] = [];
    renderSession(root, state);
    installVerdictButtons(root, (key) => pressed.push(key));

    root.querySelector<HTMLButtonElement>('.key-action[data-key="d"]')?.click();

    expect(pressed).toEqual(['d']);
  });

  it('人の番でないときは押せない（AI の操作中に判定を置かせない）', () => {
    const { awaiting: _awaiting, ...rest } = state;
    renderSession(root, { ...rest, phase: 'running' });

    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.key-action')];
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it('描き直しても、押す口は増えない', () => {
    renderSession(root, state);
    installVerdictButtons(root, () => {});
    renderSession(root, state);

    const pressed: string[] = [];
    installVerdictButtons(root, (key) => pressed.push(key));
    root.querySelector<HTMLButtonElement>('.key-action[data-key="f"]')?.click();

    expect(pressed).toEqual(['f']);
  });
});

describe('見ているケース（カーソル）を出す（Issue 013）', () => {
  const ran: SessionState = {
    runId: 'r',
    phase: 'waiting',
    awaiting: 3,
    cases: [
      { no: 1, title: 'アプリが起動する', aiResult: 'PASS', result: 'AUTO_PASS' },
      {
        no: 2,
        title: 'メモを保存できる',
        aiResult: 'BLOCKED',
        result: 'VERIFIED',
        verifiedBy: 'octocat',
      },
      { no: 3, title: '空のメモは保存できない', aiResult: 'PASS', note: '画面の文字を見た' },
      { no: 4, title: '日本語で検索できる' },
    ],
  };

  it('カーソルが指すケースが分かる（打鍵待ちとは別の印）', () => {
    renderSession(root, ran, { cursor: 1 });

    const selected = column('cases').querySelectorAll('.case-item[aria-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain('アプリが起動する');
    // 打鍵待ちの印は 3 件目のまま。
    expect(column('cases').querySelector('.case-item[aria-current="true"]')?.textContent).toContain(
      '空のメモ',
    );
  });

  it('過去のケースを見ているときは、右に「置き直し」と出る', () => {
    renderSession(root, ran, { cursor: 1 });

    const text = column('verdict').textContent ?? '';
    expect(text).toContain('アプリが起動する');
    expect(text).toContain('置き直');
  });

  it('打鍵待ちのケースを見ているときは、置き直しとは言わない', () => {
    renderSession(root, ran, { cursor: 3 });

    expect(column('verdict').textContent).not.toContain('置き直');
  });

  it('カーソルを渡さなければ、打鍵待ちのケースを見ている', () => {
    renderSession(root, ran);

    expect(column('verdict').textContent).toContain('空のメモは保存できない');
  });
});

/**
 * **保存されたかどうかが分からないまま終わらせない。**
 *
 * 配布物では `run.json` を書く処理が無く、人が 5 件を置いても何も残らなかった
 * （2026-09-04・実機で踏んだ）。書けたなら場所を、書けなかったなら理由を、画面に出す。
 */
describe('証跡の行方', () => {
  const finished = (extra: Partial<SessionState>): SessionState => {
    const { awaiting: _awaiting, ...rest } = state;
    return { ...rest, phase: 'finished', ...extra };
  };

  it('書けた場所を出す', () => {
    renderSession(root, finished({ runJsonPath: '/Users/me/Documents/git-qa/runs/x/run.json' }));

    expect(column('verdict').textContent).toContain('/Users/me/Documents/git-qa/runs/x/run.json');
  });

  it('書けなかったら理由を出す（黙って消さない）', () => {
    renderSession(root, finished({ saveError: 'EROFS: read-only file system' }));

    expect(column('verdict').textContent).toContain('EROFS');
  });
});
