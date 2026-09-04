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
