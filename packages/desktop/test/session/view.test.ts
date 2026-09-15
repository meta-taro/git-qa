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
    // **帯そのものを見る。**↑ ↓ の説明にも「置き直せる」と書いてあるので、
    // 本文の文字列だけで見分けると、説明を直したときに落ちる（2026-09-07 に落ちた）。
    expect(column('verdict').querySelector('.verdict-revise')).not.toBeNull();
  });

  it('打鍵待ちのケースを見ているときは、置き直しの帯を出さない', () => {
    renderSession(root, ran, { cursor: 3 });

    expect(column('verdict').querySelector('.verdict-revise')).toBeNull();
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

/**
 * **鑑賞モードの案内**（2026-09-11・人の指示）。
 *
 * > 人はぼーっとみながら AI のテストを鑑賞します。……途中で止められる配慮も必要です。
 *
 * 押さなくても進む形であることと、**止める手**を、画面に出し続ける。
 * 出ていなければ、人は「押さないと進まない」と思って待つ。
 */
describe('renderSession — 鑑賞中', () => {
  const watching = (): SessionState => ({
    runId: '20260911-190000',
    phase: 'watching',
    awaiting: 1,
    watch: { pauseMs: 4000 },
    cases: [
      { no: 1, title: 'メモを保存できる', aiResult: 'PASS' },
      { no: 2, title: 'メモを削除できる' },
    ],
  });

  it('鑑賞中であることを出す', () => {
    renderSession(root, watching());

    expect(root.textContent).toContain('鑑賞');
  });

  /** **押さなくても進む**ことを、押す前に言う。 */
  it('押さなければ進むことを出す', () => {
    renderSession(root, watching());

    expect(root.querySelector('.verdict-watching')?.textContent).toContain('4');
  });

  /** **止める手を出す。**打鍵だけにしない —— 初めて触る人は Esc を知らない。 */
  it('止める押しボタンを出す', () => {
    renderSession(root, watching());

    const stop = root.querySelector<HTMLElement>('.key-action[data-key="Escape"]');
    expect(stop).not.toBeNull();
    expect(stop?.textContent).toContain('止め');
  });

  /** 鑑賞でないときは出さない。**要らない案内で画面を埋めない。** */
  it('普段の実行では出さない', () => {
    const { watch: _watch, ...rest } = watching();
    renderSession(root, { ...rest, phase: 'waiting' });

    expect(root.querySelector('.verdict-watching')).toBeNull();
    expect(root.querySelector('.key-action[data-key="Escape"]')).toBeNull();
  });
});

/**
 * **窓を縮めると、判定キーの説明が下から消える**（外部レビュー meta-taro/git-qa#15）。
 *
 * > | 1269 x 782 | D / F / A / S / スペース / ↑ / ↓ の **7 つ** |
 * > | 960 x 700  | D / F / A / S / スペース の **5 つ** |
 * >
 * > **↑ と ↓（前のケースを見る・次のケースを見る）が丸ごと消えます。**
 * > パネルが縦に流れるだけで、スクロールもしないようでした。
 *
 * **報告のときより増えている。**#13 で拡大の 3 つ（`+` `−` `0`）を足したので、
 * いまは 10 個が縦に積まれる。**消える量は報告時より多い。**
 *
 * 原因は `.column { overflow: hidden }`。**はみ出したぶんを、流しもせずに捨てていた。**
 * 畳める形（#13 の提案 2）より先に、**どんな幅でも全部に届く**ようにする ——
 * 畳む形は「畳んだ人にだけ見えない」状態を新しく作るので、後でよい。
 */
describe('判定カラム — 幅が足りないときに、下を捨てない', () => {
  const readCss = async (): Promise<string> => {
    const { readFile } = await import('node:fs/promises');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    return readFile(path.resolve(here, '../../src/styles.css'), 'utf8');
  };

  it('はみ出したら流す規則が CSS にある', async () => {
    const css = await readCss();
    const rule = css.slice(css.indexOf('.column {'), css.indexOf('.column-heading {'));

    expect(rule).toContain('overflow-y: auto');
  });

  /** **流しても、どの欄かは見えたまま。**見出しが一緒に流れると、何の一覧か分からなくなる。 */
  it('流しても、見出しは残る', async () => {
    const css = await readCss();
    const head = css.indexOf('.column-heading {');
    const rule = css.slice(head, css.indexOf('}', head));

    expect(rule).toContain('position: sticky');
    // 地の色を敷かないと、流れてきた文字が見出しの下に透ける。
    expect(rule).toContain('background: Canvas');
  });

  /**
   * **真ん中も同じだった**（2026-09-15・人が実物で見つけた）。
   *
   * > あとこれ真ん中スクロールできないとみきれてるね
   *
   * 準備の画面は真ん中のカラムに出る。**「続きから」の一覧が下にあるので、
   * そこが丸ごと切れていた。**判定カラムだけ直したのは、片手落ちだった。
   */
  it('判定カラムだけの規則にしない（どのカラムでも同じ）', async () => {
    const css = await readCss();

    expect(css).not.toContain("[data-column-id='verdict'] {");
  });
});
