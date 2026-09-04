// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderColumns } from '../../src/render.js';
import { renderSetup } from '../../src/setup/view.js';
import type { SetupState } from '../../src/setup/client.js';

/**
 * アプリを開いた人が、**ターミナルを見ずに端末とシートを選んで始められる**画面（Issue 011 段階 3）。
 */

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  renderColumns(root);
});

const live = (): HTMLElement => root.querySelector<HTMLElement>('[data-column-id="live"]')!;

const idle: SetupState = {
  phase: 'idle',
  devices: [
    { serial: 'emulator-5554', state: 'device' },
    { serial: 'R5CT1234', state: 'device' },
  ],
  sheets: ['/repo/docs/a.tsv', '/repo/docs/b.tsv'],
};

describe('renderSetup', () => {
  it('見えている端末を選べる', () => {
    renderSetup(root, idle, { onStart: vi.fn() });

    const devices = live().querySelectorAll('.setup-device');
    expect(devices).toHaveLength(2);
    expect(devices[0]?.textContent).toContain('emulator-5554');
  });

  it('検証シートを選べる', () => {
    renderSetup(root, idle, { onStart: vi.fn() });

    expect(live().querySelectorAll('.setup-sheet')).toHaveLength(2);
  });

  it('選んで押すと、その組で始める', () => {
    const onStart = vi.fn();
    renderSetup(root, idle, { onStart, operator: 'octocat' });

    live().querySelector<HTMLElement>('.setup-device[data-serial="R5CT1234"]')?.click();
    live().querySelector<HTMLElement>('.setup-sheet[data-path="/repo/docs/b.tsv"]')?.click();
    live().querySelector<HTMLButtonElement>('.setup-start')?.click();

    expect(onStart).toHaveBeenCalledWith({
      serial: 'R5CT1234',
      sheetPath: '/repo/docs/b.tsv',
      operator: 'octocat',
    });
  });

  it('端末が見えていなければ、始められない（繋いでくださいと出す）', () => {
    renderSetup(root, { ...idle, devices: [] }, { onStart: vi.fn() });

    expect(live().querySelector<HTMLButtonElement>('.setup-start')?.disabled).toBe(true);
    expect(live().textContent).toContain('繋');
  });

  it('シートが見つからなければ、始められない', () => {
    renderSetup(root, { ...idle, sheets: [] }, { onStart: vi.fn() });

    expect(live().querySelector<HTMLButtonElement>('.setup-start')?.disabled).toBe(true);
  });

  it('始めている最中は、押せない', () => {
    renderSetup(root, { ...idle, phase: 'starting' }, { onStart: vi.fn() });

    expect(live().querySelector<HTMLButtonElement>('.setup-start')?.disabled).toBe(true);
  });

  it('始められなかった理由を出す（黙って戻さない）', () => {
    renderSetup(
      root,
      { ...idle, phase: 'failed', error: '端末が見つからない' },
      { onStart: vi.fn() },
    );

    expect(live().textContent).toContain('端末が見つからない');
  });

  it('描き直しても増えない', () => {
    renderSetup(root, idle, { onStart: vi.fn() });
    renderSetup(root, idle, { onStart: vi.fn() });

    expect(live().querySelectorAll('.setup-device')).toHaveLength(2);
  });

  it('左右のカラムには触らない', () => {
    const cases = root.querySelector<HTMLElement>('[data-column-id="cases"]')!;
    const before = cases.innerHTML;

    renderSetup(root, idle, { onStart: vi.fn() });

    expect(cases.innerHTML).toBe(before);
  });
});

describe('検証シートを自分で選ぶ（Issue 011 段階 3 の続き）', () => {
  /**
   * **配布物では作業ディレクトリが `/` になる**ので、探して並べるだけでは足りない
   * （実機で「検証シートが無い」と出た）。人が自分で選べる道を用意する。
   */
  it('選ぶボタンが出る', () => {
    renderSetup(root, idle, { onStart: vi.fn(), onPickSheet: vi.fn() });

    expect(live().querySelector('.setup-pick')).not.toBeNull();
  });

  it('押すと、選ぶ口が呼ばれる', () => {
    const onPickSheet = vi.fn();
    renderSetup(root, idle, { onStart: vi.fn(), onPickSheet });

    live().querySelector<HTMLButtonElement>('.setup-pick')?.click();

    expect(onPickSheet).toHaveBeenCalledOnce();
  });

  it('シートが 1 つも見つからなくても、選ぶボタンは出る', () => {
    renderSetup(root, { ...idle, sheets: [] }, { onStart: vi.fn(), onPickSheet: vi.fn() });

    expect(live().querySelector('.setup-pick')).not.toBeNull();
  });

  it('選んだシートが一覧に無くても、それで始められる', () => {
    const onStart = vi.fn();
    renderSetup(root, idle, {
      onStart,
      onPickSheet: vi.fn(),
      pickedSheet: '/どこか/別の.tsv',
      operator: 'octocat',
    });

    live().querySelector<HTMLButtonElement>('.setup-start')?.click();

    expect(onStart).toHaveBeenCalledWith({
      serial: 'emulator-5554',
      sheetPath: '/どこか/別の.tsv',
      operator: 'octocat',
    });
  });
});

describe('置いた人（ハンドル）を入れる', () => {
  /**
   * **`unknown` のまま証跡に残ると、「誰が保証したか」が読めない。**
   * この製品の芯なので、始める前に受け取る。
   */
  it('ハンドルの欄が出る', () => {
    renderSetup(root, idle, { onStart: vi.fn() });

    expect(live().querySelector('.setup-operator')).not.toBeNull();
  });

  it('覚えているハンドルが入っている', () => {
    renderSetup(root, idle, { onStart: vi.fn(), operator: 'octocat' });

    expect(live().querySelector<HTMLInputElement>('.setup-operator')?.value).toBe('octocat');
  });

  it('**空のままでは始められない**（誰が置いたか分からない証跡を作らない）', () => {
    renderSetup(root, idle, { onStart: vi.fn(), operator: '' });

    expect(live().querySelector<HTMLButtonElement>('.setup-start')?.disabled).toBe(true);
  });

  it('入れて押すと、その名前で始まる', () => {
    const onStart = vi.fn();
    renderSetup(root, idle, { onStart, operator: 'octocat' });

    live().querySelector<HTMLButtonElement>('.setup-start')?.click();

    expect(onStart).toHaveBeenCalledWith({
      serial: 'emulator-5554',
      sheetPath: '/repo/docs/a.tsv',
      operator: 'octocat',
    });
  });
});

/**
 * **始める前にハンドルを確かめる。**
 *
 * 証跡の schema は ASCII に限っている（C18）。ここで通すと、5 件置き終わったあとの
 * 保存で落ちる。実際にそれが起き、**人が実機で置いた 5 件が 2 回とも消えた**（2026-09-04）。
 */
describe('担当者ハンドルの規則', () => {
  const withHandle = (handle: string): HTMLElement => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    renderColumns(root);
    renderSetup(root, idle, { onStart: () => {}, operator: handle });
    return root;
  };

  it('日本語のハンドルでは始められない', () => {
    const root = withHandle('めたたろ');

    const start = root.querySelector<HTMLButtonElement>('.setup-start');
    expect(start?.disabled).toBe(true);
  });

  it('何が書けるのかを画面に出す（押せない理由を黙らせない）', () => {
    const root = withHandle('めたたろ');

    expect(root.textContent).toContain('英数字');
  });

  it('英数字なら始められる', () => {
    const root = withHandle('metataro');

    expect(root.querySelector<HTMLButtonElement>('.setup-start')?.disabled).toBe(false);
  });
});

/**
 * **押せないボタンは、押せない理由まで出して初めて意味がある。**
 *
 * 2026-09-04、人が実物を開いて「検証開始ボタン押せないですね」と言った。
 * 保存されていたハンドルが `めたたろ`（日本語）で、C45 の入口の検査が弾いていた。
 * **弾いたこと自体は正しい。**出していなかったのは、弾いた理由。
 *
 * 上の「何が書けるのかを画面に出す」は**規則の文が常に出ている**ことしか見ておらず、
 * 規則を破っている状態でも同じ文が出るので、この壊れ方を通していた。
 */
describe('始められない理由を画面に出す', () => {
  const render = (handle: string, state: SetupState = idle): HTMLElement => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    renderColumns(root);
    renderSetup(root, state, { onStart: () => {}, operator: handle });
    return root;
  };

  it('規則を破っているハンドルは、起動直後から破っていると分かる', () => {
    // 保存済みの値を戻したときも印が要る。**打ち始めるまで黙っていては遅い。**
    expect(render('めたたろ').querySelector<HTMLElement>('.setup-hint')?.dataset['bad']).toBe(
      'true',
    );
  });

  it('規則に合うハンドルなら、破っている印は立たない', () => {
    expect(render('metataro').querySelector<HTMLElement>('.setup-hint')?.dataset['bad']).toBe(
      'false',
    );
  });

  it('印を立てるだけでなく、見た目が変わる規則が CSS にある', async () => {
    // **dataset を立てても CSS が見ていなければ、人の目には何も起きない。**
    // 実際にそうなっていた（`data-bad` を見る規則が 1 行も無かった）。
    // **happy-dom が `URL` を差し替えている**ので、`new URL()` の結果は node の fs が受け取らない。
    // 作業ディレクトリも呼び出し方で変わるため、このファイルの位置から辿る。
    const { readFile } = await import('node:fs/promises');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const css = await readFile(path.resolve(here, '../../src/styles.css'), 'utf8');
    expect(css).toContain("[data-bad='true']");
  });

  it('ハンドルが規則に合わないときは、そう名指しで出す', () => {
    expect(render('めたたろ').querySelector('.setup-blocked')?.textContent).toContain('ハンドル');
  });

  it('ハンドルが空のときも、何をすれば始まるかを出す', () => {
    expect(render('').querySelector('.setup-blocked')?.textContent).toContain('ハンドル');
  });

  it('端末が見えていないときは、端末だと名指しで出す', () => {
    const blocked = render('metataro', { ...idle, devices: [] }).querySelector('.setup-blocked');
    expect(blocked?.textContent).toContain('端末');
  });

  it('検証シートが無いときは、シートだと名指しで出す', () => {
    const blocked = render('metataro', { ...idle, sheets: [] }).querySelector('.setup-blocked');
    expect(blocked?.textContent).toContain('検証シート');
  });

  it('始められるときは、理由を出さない', () => {
    expect(render('metataro').querySelector('.setup-blocked')).toBeNull();
  });

  it('打ち直して規則に合えば、理由がその場で消える', () => {
    const root = render('めたたろ');
    const operator = root.querySelector<HTMLInputElement>('.setup-operator')!;

    operator.value = 'metataro';
    operator.dispatchEvent(new Event('input'));

    expect(root.querySelector('.setup-blocked')).toBeNull();
    expect(root.querySelector<HTMLElement>('.setup-hint')?.dataset['bad']).toBe('false');
  });
});

/**
 * **最近開いたシートを出す。**
 *
 * ホームの下を漁るのをやめた（`sheetSearchRoots`）ので、探索で見つかるのは
 * git-qa 専用の置き場と作業ディレクトリだけになった。**リポジトリの中のシートは
 * 探索に掛からない**ので、その人が前に開いたものを覚えて出す。
 */
describe('最近開いた検証シート', () => {
  const render = (options: {
    sheets: readonly string[];
    recent?: readonly string[];
  }): HTMLElement => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    renderColumns(root);
    renderSetup(
      root,
      { ...idle, sheets: [...options.sheets] },
      {
        onStart: () => {},
        operator: 'metataro',
        ...(options.recent === undefined ? {} : { recentSheets: options.recent }),
      },
    );
    return root;
  };

  const listed = (root: HTMLElement): string[] =>
    [...root.querySelectorAll('.setup-sheet')].map((el) => el.textContent ?? '');

  it('探索で見つからなくても、前に開いたものは一覧に出る', () => {
    const root = render({ sheets: [], recent: ['/repo/git-qa/sheets/a.tsv'] });

    expect(listed(root)).toContain('/repo/git-qa/sheets/a.tsv');
  });

  it('前に開いたものが先に並ぶ', () => {
    const root = render({ sheets: ['/dedicated/x.tsv'], recent: ['/repo/a.tsv'] });

    expect(listed(root)[0]).toBe('/repo/a.tsv');
  });

  it('探索でも見つかったものは、二重に並べない', () => {
    const root = render({ sheets: ['/repo/a.tsv'], recent: ['/repo/a.tsv'] });

    expect(listed(root)).toEqual(['/repo/a.tsv']);
  });

  it('探索が空でも、前に開いたものがあれば始められる', () => {
    const root = render({ sheets: [], recent: ['/repo/a.tsv'] });

    expect(root.querySelector<HTMLButtonElement>('.setup-start')?.disabled).toBe(false);
  });
});
