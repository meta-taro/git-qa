import { describe, expect, it } from 'vitest';

import { judgeExpectation, planExpectation, planSteps } from '../../src/run/steps.js';

/**
 * 検証シートの日本語の手順を、操作へ落とす所。
 *
 * **落とせないものは落とせないと言う。**推測で操作すると、
 * 画面の別の場所を触ったまま `AUTO_PASS` が積み上がる（Issue 004 の「判断保留」）。
 */

describe('planSteps — 手順を操作へ落とす', () => {
  it('番号付きの複数行を 1 手順ずつに割る', () => {
    const steps = planSteps('1. 保存をタップする\n2. 完了をタップする');

    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.kind)).toEqual(['action', 'action']);
  });

  it('空行と前後の空白を捨てる', () => {
    expect(planSteps('  1. 保存をタップする  \n\n')).toHaveLength(1);
  });

  it('「X をタップする」を tap に落とす', () => {
    const [step] = planSteps('1. 保存をタップする');

    expect(step).toEqual({
      kind: 'action',
      text: '保存をタップする',
      action: { kind: 'tap', target: { at: 'element', ref: '保存' } },
    });
  });

  it('鉤括弧付きの指定でも中身だけを見る', () => {
    const [step] = planSteps('「+」をタップする');

    expect(step).toMatchObject({
      action: { kind: 'tap', target: { at: 'element', ref: '+' } },
    });
  });

  /**
   * **実物の検証シートは「押す」と書く**（2026-09-07）。
   *
   * 実物の検証シート 55 行（あるデスクトップアプリのもの）を通したら、
   * 「「⚙ 管理」を押す」のような行が全部落ちた。**日本語の button は「押す」。**
   */
  it('鉤括弧付きの「押す」も tap に落とす', () => {
    const [step] = planSteps('「⚙ 管理」を押す');

    expect(step).toMatchObject({
      action: { kind: 'tap', target: { at: 'element', ref: '⚙ 管理' } },
    });
  });

  it('「押下する」も同じ', () => {
    const [step] = planSteps('「保存」を押下する');

    expect(step).toMatchObject({
      action: { kind: 'tap', target: { at: 'element', ref: '保存' } },
    });
  });

  /**
   * **鉤括弧の無い「押す」は受けない。**
   *
   * 「Win+← を押す」「Enter を押す」は**キーの話**で、画面の文字ではない。
   * 「クリック」なら鉤括弧が無くても要素だと決まるが、「押す」は決まらない。
   * **決まらないものを当てにいくと、無い要素を探して別の理由で落ちる。**
   */
  it('鉤括弧の無い「押す」は保留にする（キー操作と区別できない）', () => {
    const [step] = planSteps('3. Win+← を押す');

    expect(step).toMatchObject({ kind: 'hold' });
  });

  it('「X に「Y」と入力する」を type に落とす', () => {
    const [step] = planSteps('1. 本文に「abc」と入力する');

    expect(step).toMatchObject({
      action: { kind: 'type', text: 'abc', target: { at: 'element', ref: '本文' } },
    });
  });

  it('非 ASCII の入力は判断保留にする（端末の input text は IME を通らない）', () => {
    const [step] = planSteps('1. 本文に「あいうえお」と入力する');

    expect(step?.kind).toBe('hold');
    // 送れない文字列を理由に含める。人が読んで「自分で打てばよい」と分かる形にする。
    expect(step?.kind === 'hold' && step.reason).toContain('あいうえお');
  });

  it('操作の語彙に無い動作は判断保留にする', () => {
    const [step] = planSteps('1. メモを長押しする');

    expect(step?.kind).toBe('hold');
    expect(step?.text).toBe('メモを長押しする');
    expect(step?.kind === 'hold' && step.reason).toContain('メモを長押しする');
  });

  it('手順が空なら判断保留を 1 件返す（空の操作列にして通さない）', () => {
    const steps = planSteps('   ');

    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe('hold');
  });

  it('「何も入力せずに保存をタップする」は、その文字列の要素を探す形に落ちる', () => {
    // **ここは意図した挙動。**文を読み解いて「保存」だけを取り出すような推測はしない。
    // 画面にその要素が無ければ実行時に見つからず、判断保留として人へ渡る。
    const [step] = planSteps('2. 何も入力せずに保存をタップする');

    expect(step).toMatchObject({
      action: { kind: 'tap', target: { at: 'element', ref: '何も入力せずに保存' } },
    });
  });
});

describe('planExpectation — 期待結果を、機械で見られる形に落とす', () => {
  it('鉤括弧の中身を、画面に在るかどうかの検査にする', () => {
    expect(planExpectation('「本文を入力してください」と表示され、保存されない')).toEqual({
      kind: 'contains',
      text: '本文を入力してください',
    });
  });

  it('鉤括弧が無ければ判断保留（機械では決められない）', () => {
    expect(planExpectation('ホーム画面が表示される')).toMatchObject({ kind: 'hold' });
  });

  it('鉤括弧が 2 つ以上あれば判断保留（どれを見ればよいか決められない）', () => {
    expect(planExpectation('「あ」と「い」が並ぶ')).toMatchObject({ kind: 'hold' });
  });

  it('空の期待結果は判断保留', () => {
    expect(planExpectation('  ')).toMatchObject({ kind: 'hold' });
  });
});

describe('judgeExpectation — 画面の文字と突き合わせる', () => {
  const check = { kind: 'contains', text: 'あいうえお' } as const;

  it('在れば PASS', () => {
    expect(judgeExpectation(check, 'メモ一覧 あいうえお 2 件')).toBe('PASS');
  });

  it('無ければ FAIL', () => {
    expect(judgeExpectation(check, 'メモ一覧 0 件')).toBe('FAIL');
  });
});

/**
 * **実物の検証シートは、ほぼ必ず 1 行目が「アプリを起動する」で始まる。**
 * ここが落とせないと、どのシートを持ってきても 1 件目で止まる
 * （2026-09-02 の実行記録は 5 件とも BLOCKED だった）。
 *
 * ただし**アプリ名からパッケージを当てにいかない。**「設定」がどのパッケージかは
 * 端末と地域で変わる。当てて別のアプリを起動すると、画面は動くので通ったように見える。
 * **起動先はシートに書いてあるものだけを使う。**
 */
describe('planSteps — 起動', () => {
  it('「アプリを起動する」を、シートが宣言したパッケージの launch に落とす', () => {
    const [step] = planSteps('1. アプリを起動する', { app: 'com.android.settings' });

    expect(step).toEqual({
      kind: 'action',
      text: 'アプリを起動する',
      action: { kind: 'launch', app: 'com.android.settings' },
    });
  });

  it('パッケージ名を直接書いてもよい', () => {
    expect(planSteps('「com.android.settings」を起動する')).toEqual([
      {
        kind: 'action',
        text: '「com.android.settings」を起動する',
        action: { kind: 'launch', app: 'com.android.settings' },
      },
    ]);
  });

  it('宣言が無ければ、何を書けばよいかを添えて止まる', () => {
    const [step] = planSteps('アプリを起動する');

    expect(step).toMatchObject({ kind: 'hold' });
    expect((step as { reason: string }).reason).toContain('# 対象:');
  });

  it('宣言がパッケージ名の形でなければ止まる（推測で起動しない）', () => {
    const [step] = planSteps('アプリを起動する', { app: 'example/sample-notes-app@main' });

    expect(step).toMatchObject({ kind: 'hold' });
    expect((step as { reason: string }).reason).toContain('example/sample-notes-app@main');
  });

  it('アプリ名を書かれても当てにいかない', () => {
    // 「設定」がどのパッケージかは端末と地域で変わる。**当てない。**
    const [step] = planSteps('設定を起動する', { app: 'com.android.settings' });

    expect(step).toMatchObject({ kind: 'hold', text: '設定を起動する' });
    expect((step as { reason: string }).reason).toContain('設定');
  });
});

/**
 * **ウェブのシートが 1 件目で止まった**（2026-09-06・実測）。
 *
 * `pnpm run:sheet:web` で見本のシートを走らせたら、1 行目「ページを起動する」が
 * `どのアプリを起動するか決められない: ページ。パッケージ名（例 com.example.app）で書く`
 * で判断保留になった。**Android のパッケージ名しか通していなかった。**
 *
 * C40 と同じ形。**どのシートを持ってきても 1 件目で止まる**状態だった。
 */
describe('ウェブの起動（Issue 015）', () => {
  const target = 'http://127.0.0.1:8731/page.html';

  it('「ページを起動する」で、シートが宣言した URL へ行く', () => {
    const planned = planSteps('ページを起動する', { app: target });

    expect(planned).toEqual([
      { kind: 'action', text: 'ページを起動する', action: { kind: 'launch', app: target } },
    ]);
  });

  it('「ページを開く」でも同じ', () => {
    expect(planSteps('ページを開く', { app: target })[0]).toEqual({
      kind: 'action',
      text: 'ページを開く',
      action: { kind: 'launch', app: target },
    });
  });

  it('URL がそのまま書いてあれば、そこへ行く', () => {
    expect(planSteps('https://example.com/ を開く', { app: target })[0]).toEqual({
      kind: 'action',
      text: 'https://example.com/ を開く',
      action: { kind: 'launch', app: 'https://example.com/' },
    });
  });

  /** **見出しが無いのに「ページを起動する」と書かれたら、当て推量で開かない。** */
  it('見出しに URL が無ければ、どこへ行くか決めない', () => {
    const planned = planSteps('ページを起動する');

    expect(planned[0]?.kind).toBe('hold');
    expect((planned[0] as { reason: string }).reason).toMatch(/# 対象:/);
  });

  it('アプリの言い方は今までどおり（Android を壊さない）', () => {
    expect(planSteps('アプリを起動する', { app: 'com.example.app' })[0]).toEqual({
      kind: 'action',
      text: 'アプリを起動する',
      action: { kind: 'launch', app: 'com.example.app' },
    });
  });
});

/**
 * **文字を送れる範囲は、相手によって違う**（Issue 015）。
 *
 * Android の `input text` は IME を通らないので ASCII しか送れない。
 * ブラウザはそのまま入る。**Android の事情を、すべての相手に押し付けない。**
 *
 * 2026-09-06、ウェブの見本シートに「「お名前」に「テスト太郎」と入力する」と書いたら、
 * `端末の入力は IME を通らないので送れない` で止まった。**ブラウザなら送れる。**
 */
describe('文字を送れる範囲（Issue 015）', () => {
  it('既定は今までどおり、ASCII だけ（Android を壊さない）', () => {
    const [step] = planSteps('「お名前」に「テスト太郎」と入力する');

    expect(step?.kind).toBe('hold');
    expect((step as { reason: string }).reason).toMatch(/IME/);
  });

  it('そのまま入る相手なら、日本語も送る', () => {
    const [step] = planSteps('「お名前」に「テスト太郎」と入力する', { textInput: 'any' });

    expect(step).toEqual({
      kind: 'action',
      text: '「お名前」に「テスト太郎」と入力する',
      action: {
        kind: 'type',
        text: 'テスト太郎',
        target: { at: 'element', ref: 'お名前' },
      },
    });
  });
});

/**
 * **行き先の書き方も、相手によって違う**（Issue 016 / C55）。
 *
 * Android はパッケージ名、ウェブは URL、**デスクトップはアプリ名そのもの**。
 * 2026-09-06、`# 対象: warifu` のシートが
 * `シートの見出し「# 対象:」が、パッケージ名でも URL でもない: warifu` で止まった。
 *
 * **表示名を通さない**という決めごと（C40）は Android の話。
 * どのパッケージかが端末と地域で変わるのが理由で、**デスクトップにその問題は無い。**
 */
describe('行き先の書き方（Issue 016）', () => {
  it('既定は今までどおり、パッケージ名か URL（Android / ウェブを壊さない）', () => {
    const [step] = planSteps('アプリを起動する', { app: 'warifu' });

    expect(step?.kind).toBe('hold');
    expect((step as { reason: string }).reason).toMatch(/パッケージ名/);
  });

  it('名前で指す相手なら、そのまま通す', () => {
    const [step] = planSteps('アプリを起動する', { app: 'warifu', appId: 'name' });

    expect(step).toEqual({
      kind: 'action',
      text: 'アプリを起動する',
      action: { kind: 'launch', app: 'warifu' },
    });
  });
});

/**
 * **並べ替えは、実物の画面でよく出る**（Issue 015 の試験運用で人が挙げた）。
 *
 * > DnD はできるのか
 *
 * なぞる（swipe）とは別物。**なぞりはスクロール、ドラッグは物を移す。**
 * 同じ命令にまとめると、どちらのつもりで書いたのかが読めなくなる。
 */
describe('ドラッグ（Issue 015）', () => {
  it('「A」を「B」へドラッグする', () => {
    const [step] = planSteps('「見出し」を「本文」へドラッグする');

    expect(step).toEqual({
      kind: 'action',
      text: '「見出し」を「本文」へドラッグする',
      action: {
        kind: 'drag',
        from: { at: 'element', ref: '見出し' },
        to: { at: 'element', ref: '本文' },
      },
    });
  });

  it('「A」を「B」にドラッグする（「に」でも同じ）', () => {
    expect(planSteps('「A」を「B」にドラッグする')[0]?.kind).toBe('action');
  });

  it('「A」を「B」へドラッグ＆ドロップする', () => {
    expect(planSteps('「A」を「B」へドラッグ＆ドロップする')[0]?.kind).toBe('action');
  });
});

/**
 * **文字を送る口を持たない相手**（2026-09-12・Windows のデスクトップ検証）。
 *
 * Windows 版はまだ文字を送れない（UI Automation の `Invoke` しか実装していない）。
 * `ascii-only` と名乗らせると、**送れないものを送ろうとして実行時に落ちる。**
 * **planning の段で「人が入力する」に倒す**ほうが、証跡として正しい。
 */
describe('planType — 文字を送れない相手', () => {
  it('送れないなら、人に回す', () => {
    const planned = planSteps('1. 検索欄に「dbboard」と入力する', { textInput: 'none' });

    expect(planned[0]?.kind).toBe('hold');
    expect(planned[0]?.kind === 'hold' && planned[0].reason).toContain('人');
  });

  /** 送れる相手は、今までどおり。 */
  it('送れる相手は、今までどおり打つ', () => {
    const planned = planSteps('1. 検索欄に「dbboard」と入力する', { textInput: 'any' });

    expect(planned[0]?.kind).toBe('action');
  });
});
