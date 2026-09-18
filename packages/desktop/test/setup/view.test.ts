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
      // **何で見たかも一緒に渡す。**証跡に版が残る（2026-09-06）。
      browser: 'chrome',
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
      // **何で見たかも一緒に渡す。**証跡に版が残る（2026-09-06）。
      browser: 'chrome',
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
      // **何で見たかも一緒に渡す。**証跡に版が残る（2026-09-06）。
      browser: 'chrome',
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

  it('空白の入ったハンドルでは始められない', () => {
    // **日本語は通る**（C53）。弾くのは空白・区切り・長すぎるものだけ。
    const root = withHandle('めた たろ');

    const start = root.querySelector<HTMLButtonElement>('.setup-start');
    expect(start?.disabled).toBe(true);
  });

  it('日本語のハンドルなら始められる', () => {
    const root = withHandle('めたたろ');

    const start = root.querySelector<HTMLButtonElement>('.setup-start');
    expect(start?.disabled).toBe(false);
  });

  it('何が書けるのかを画面に出す（押せない理由を黙らせない）', () => {
    const root = withHandle('めた たろ');

    expect(root.textContent).toContain('空白');
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
    expect(render('めた たろ').querySelector<HTMLElement>('.setup-hint')?.dataset['bad']).toBe(
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

  /**
   * **押せない理由が、自分の枠の外へ押し出されて見えなくなっていた**（2026-09-06）。
   *
   * カラムは縦の flex で、`.setup` の下に「はじめかた」が並ぶ。既定のままだと両方が縮み、
   * `.setup` のいちばん下にある理由の行が、`overflow-y: auto` の外に出る。
   * **文は DOM にあるのに、人の目には何も出ていない。**画面の部品を読んで気づいた
   * （理由の行 y=523〜557 の上に「はじめかた」が y=537 から重なっていた）。
   */
  it('準備の欄は縮まない規則が CSS にある（理由の行が枠の外へ出ない）', async () => {
    const { readFile } = await import('node:fs/promises');
    const url = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const css = await readFile(path.resolve(here, '../../src/styles.css'), 'utf8');
    const setup = css.slice(css.indexOf('.setup {'), css.indexOf('.setup-title'));

    expect(setup).toContain('flex: 0 0 auto');
    // 自分で縦に切らない。切ると、いちばん下の理由がまた隠れる。
    expect(setup).not.toContain('overflow-y: auto');
  });

  it('ハンドルが規則に合わないときは、そう名指しで出す', () => {
    expect(render('めた たろ').querySelector('.setup-blocked')?.textContent).toContain('ハンドル');
  });

  /**
   * **日本語のハンドルで始められる**（C53・2026-09-06）。
   *
   * 人が実物の前で 2 度止まり、2 度目に「いやです。ただちに修正しなさい」と言った。
   * 止めていたのは規則のほうで、**直すべきだったのも規則のほう。**
   */
  it('日本語のハンドルなら、始められない理由は出ない', () => {
    expect(render('めたたろ').querySelector('.setup-blocked')).toBeNull();
  });

  it('日本語のハンドルでも、破っている印は立たない', () => {
    expect(render('めたたろ').querySelector<HTMLElement>('.setup-hint')?.dataset['bad']).toBe(
      'false',
    );
  });

  it('空白や区切りが入っていたら、そこを名指しで出す', () => {
    const blocked = render('めた たろ').querySelector('.setup-blocked')?.textContent ?? '';

    // **規則を読ませるのではなく、目の前の値の何が駄目かを言う。**
    expect(blocked).toContain('空白');
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

/**
 * **鑑賞モード**（2026-09-11・人の指示）。
 *
 * > auto を git-qa まんま操作するパターンを実装します。……人はぼーっとみながら
 * > AI のテストを鑑賞します。
 *
 * **始める人が選ぶ。**既定は今までどおり（押すまで進まない）。
 * 押さなくても進むのは、選んだ人が分かっていて選んだときだけにする。
 */
/**
 * **鑑賞モード**（2026-09-11・人の指示）。
 *
 * > auto を git-qa まんま操作するパターンを実装します。……人はぼーっとみながら
 * > AI のテストを鑑賞します。
 *
 * **始める人が選ぶ。**既定は今までどおり（押すまで進まない）。
 * 押さなくても進むのは、選んだ人が分かっていて選んだときだけにする。
 */
describe('renderSetup — 鑑賞モード', () => {
  const choose = (): void => {
    live().querySelector<HTMLElement>('.setup-device[data-serial="R5CT1234"]')?.click();
    live().querySelector<HTMLElement>('.setup-sheet[data-path="/repo/docs/b.tsv"]')?.click();
  };

  it('鑑賞で始めるかを選べる', () => {
    renderSetup(root, idle, { onStart: vi.fn(), operator: 'octocat' });

    expect(live().querySelector('input.setup-watch')).not.toBeNull();
  });

  it('選ばなければ、鑑賞では始めない', () => {
    const onStart = vi.fn();
    renderSetup(root, idle, { onStart, operator: 'octocat' });

    choose();
    live().querySelector<HTMLButtonElement>('.setup-start')?.click();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0]?.[0]).not.toHaveProperty('watch');
  });

  it('選べば、鑑賞で始める', () => {
    const onStart = vi.fn();
    renderSetup(root, idle, { onStart, operator: 'octocat' });

    choose();
    live().querySelector<HTMLInputElement>('input.setup-watch')!.checked = true;
    live().querySelector<HTMLButtonElement>('.setup-start')?.click();

    expect(onStart.mock.calls[0]?.[0]).toMatchObject({ watch: true });
  });
});

/**
 * **続きから**（2026-09-12・人の指示）。
 *
 * > それは途中までテストして、落として、次の日検証を再開しても大丈夫ですかね
 *
 * 途中で止まった実行を出し、選んだら**その実行に足す。**
 * **どこまで人が見て置いたか**を添える —— 選ぶときに、いちばん知りたいのがそこ。
 */
describe('renderSetup — 続きから', () => {
  const withResumable = (): SetupState => ({
    ...idle,
    resumable: [
      {
        runId: '20260911-090000',
        sheetPath: '/repo/docs/b.tsv',
        startedAt: '2026-09-11T09:00:00.000Z',
        cases: 4,
        placed: 3,
      },
    ],
  });

  it('止まった実行を、どこまで置いたか付きで出す', () => {
    renderSetup(root, withResumable(), { onStart: vi.fn(), operator: 'octocat' });

    const item = live().querySelector<HTMLElement>('.setup-resume');
    expect(item?.textContent).toContain('20260911-090000');
    expect(item?.textContent).toContain('3');
  });

  /** 選ぶと、**そのシートとその実行**で始める。人はシートを選び直さない。 */
  it('選んで押すと、その実行の続きから始める', () => {
    const onStart = vi.fn();
    renderSetup(root, withResumable(), { onStart, operator: 'octocat' });

    live().querySelector<HTMLElement>('.setup-resume')?.click();
    live().querySelector<HTMLElement>('.setup-device[data-serial="R5CT1234"]')?.click();
    live().querySelector<HTMLButtonElement>('.setup-start')?.click();

    expect(onStart.mock.calls[0]?.[0]).toMatchObject({
      serial: 'R5CT1234',
      sheetPath: '/repo/docs/b.tsv',
      resume: '20260911-090000',
    });
  });

  /** **止まった実行が無ければ、何も出さない。**要らない案内で画面を埋めない。 */
  it('止まった実行が無ければ、出さない', () => {
    renderSetup(root, idle, { onStart: vi.fn(), operator: 'octocat' });

    expect(live().querySelector('.setup-resume')).toBeNull();
  });

  /** 選ばなければ、**今までどおり新しい実行。** */
  it('選ばなければ、続きからにしない', () => {
    const onStart = vi.fn();
    renderSetup(root, withResumable(), { onStart, operator: 'octocat' });

    live().querySelector<HTMLElement>('.setup-device[data-serial="R5CT1234"]')?.click();
    live().querySelector<HTMLElement>('.setup-sheet[data-path="/repo/docs/b.tsv"]')?.click();
    live().querySelector<HTMLButtonElement>('.setup-start')?.click();

    expect(onStart.mock.calls[0]?.[0]).not.toHaveProperty('resume');
  });
});

/**
 * **端末が見えない理由を出す**（2026-09-12・導入の直前に見つけた）。
 *
 * `adb` が入っていない機械では、端末は 1 つも出ない。
 * それ自体は普通のことで、**ウェブだけ見るなら URL を入れて進める。**
 * ところが「端末が見えていない。USB で繋ぐか…」としか出ないので、
 * **入っていない道具を探しに行かせてしまう。**
 */
describe('renderSetup — 端末を数えられなかったとき', () => {
  it('理由を出す', () => {
    renderSetup(
      root,
      { ...idle, devices: [], deviceError: 'spawn adb ENOENT' },
      { onStart: vi.fn(), operator: 'octocat' },
    );

    expect(live().textContent).toContain('adb');
  });

  /** **他の道は残す。**ウェブの URL 欄は出ている。 */
  it('ウェブの URL では進められる', () => {
    renderSetup(
      root,
      { ...idle, devices: [], deviceError: 'spawn adb ENOENT' },
      { onStart: vi.fn(), operator: 'octocat' },
    );

    expect(live().querySelector('.setup-web')).not.toBeNull();
  });
});

/**
 * **1 本走らせたあと、入口へ戻れる**（外部レビュー meta-taro/git-qa#5）。
 *
 * > シートを 1 本走らせ終えると、その入口の画面は二度と使えません。
 *
 * 実行器は `done` を知るようになったので、画面も**終わったことを出して、
 * 次を始められる**形にする。
 */
describe('renderSetup — 走り終えたあと', () => {
  const finished = (): SetupState => ({ ...idle, phase: 'done' });

  it('終わったことを出す', () => {
    renderSetup(root, finished(), { onStart: vi.fn(), operator: 'octocat' });

    expect(live().textContent).toContain('終わ');
  });

  /** **次を選べる。**端末もシートも出ている。 */
  it('次のシートを選んで始められる', () => {
    const onStart = vi.fn();
    renderSetup(root, finished(), { onStart, operator: 'octocat' });

    live().querySelector<HTMLElement>('.setup-device[data-serial="R5CT1234"]')?.click();
    live().querySelector<HTMLElement>('.setup-sheet[data-path="/repo/docs/b.tsv"]')?.click();
    live().querySelector<HTMLButtonElement>('.setup-start')?.click();

    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

/**
 * **どの版を使っているか、本人にも分からなかった**（2026-09-18）。
 *
 * `beta.3` も `beta.12` も名乗りは `0.2.0` のまま。**報告に版が書けない。**
 * 試験導入先で「beta.8 で直した」が効いていない場面があり、
 * **こちらも相手も、何を触っているのか確かめられなかった。**
 */
describe('版の名乗り', () => {
  it('準備の画面に版が出る（人が報告へ書き写せる所）', () => {
    renderSetup(root, idle, { onStart: vi.fn(), release: 'v0.2.0-beta.12' });

    expect(live().querySelector('.setup-release')?.textContent).toContain('v0.2.0-beta.12');
  });

  it('分からないときは出さない（空の欄を置くと、消えた版のように見える）', () => {
    renderSetup(root, idle, { onStart: vi.fn() });

    expect(live().querySelector('.setup-release')).toBeNull();
  });
});
