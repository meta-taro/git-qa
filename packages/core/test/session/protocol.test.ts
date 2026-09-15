import { describe, expect, it } from 'vitest';

import { parseHumanInput, parseSessionState } from '../../src/session/protocol.js';

/**
 * 画面（webview）と実行器（Node）がやりとりする形。
 *
 * **どちらも相手を信用しない。**橋を通って来るものは `unknown` で、
 * 形が違えば受け取らない。受け取ってしまうと、`run.json` に嘘が入る。
 */

describe('parseHumanInput — 画面から届いた打鍵', () => {
  it('人の判定を受け取る', () => {
    expect(parseHumanInput({ kind: 'verdict', caseNo: 3, humanResult: 'VERIFIED' })).toEqual({
      kind: 'verdict',
      caseNo: 3,
      humanResult: 'VERIFIED',
    });
  });

  it('置かずに次へ進む指示を受け取る', () => {
    expect(parseHumanInput({ kind: 'advance', caseNo: 3 })).toEqual({ kind: 'advance', caseNo: 3 });
  });

  it('取り消しはまだ受け取らない（実装が無いものを型で通さない）', () => {
    expect(parseHumanInput({ kind: 'undo' })).toBeUndefined();
  });

  it('AUTO_PASS は人の値ではないので受け取らない（C17）', () => {
    expect(
      parseHumanInput({ kind: 'verdict', caseNo: 1, humanResult: 'AUTO_PASS' }),
    ).toBeUndefined();
  });

  it('知らない形は受け取らない', () => {
    expect(parseHumanInput({ kind: 'verdict', caseNo: 1 })).toBeUndefined();
    expect(
      parseHumanInput({ kind: 'verdict', caseNo: '1', humanResult: 'VERIFIED' }),
    ).toBeUndefined();
    expect(parseHumanInput({ kind: 'なにか' })).toBeUndefined();
    expect(parseHumanInput('verdict')).toBeUndefined();
    expect(parseHumanInput(null)).toBeUndefined();
  });

  it('ケース番号は 1 以上の整数でなければ受け取らない', () => {
    expect(parseHumanInput({ kind: 'advance', caseNo: 0 })).toBeUndefined();
    expect(parseHumanInput({ kind: 'advance', caseNo: 1.5 })).toBeUndefined();
  });
});

describe('parseSessionState — Node から届いた実行状態', () => {
  const state = {
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
      { no: 2, title: 'メモを保存できる', aiResult: 'PASS' },
    ],
  };

  it('そのまま読める', () => {
    expect(parseSessionState(state)).toEqual(state);
  });

  it('ケースが無ければ受け取らない', () => {
    expect(parseSessionState({ runId: 'r', phase: 'running' })).toBeUndefined();
  });

  it('知らない phase は受け取らない', () => {
    expect(parseSessionState({ ...state, phase: 'ねている' })).toBeUndefined();
  });

  it('知らない結果の値は受け取らない', () => {
    expect(
      parseSessionState({ ...state, cases: [{ no: 1, title: 'あ', aiResult: 'VERIFIED' }] }),
    ).toBeUndefined();
  });
});

describe('parseHumanInput — 人が端末を触る', () => {
  it('画面の中の tap を受け取る', () => {
    expect(parseHumanInput({ kind: 'tap', caseNo: 2, x: 540, y: 1200 })).toEqual({
      kind: 'tap',
      caseNo: 2,
      x: 540,
      y: 1200,
    });
  });

  it('座標が無い・数でないものは受け取らない', () => {
    expect(parseHumanInput({ kind: 'tap', caseNo: 2, x: 540 })).toBeUndefined();
    expect(parseHumanInput({ kind: 'tap', caseNo: 2, x: '540', y: 1200 })).toBeUndefined();
  });

  it('負の座標は受け取らない（枠の外を押している）', () => {
    expect(parseHumanInput({ kind: 'tap', caseNo: 2, x: -1, y: 10 })).toBeUndefined();
  });

  it('整数でない座標は丸めずに捨てる（端末は画素の位置しか受け取らない）', () => {
    expect(parseHumanInput({ kind: 'tap', caseNo: 2, x: 10.5, y: 10 })).toBeUndefined();
  });
});

describe('parseSessionState — 検証シートの場所', () => {
  const base = { runId: 'r', phase: 'running', cases: [] };

  it('シートの場所を持てる（メニューから開くために要る）', () => {
    expect(parseSessionState({ ...base, sheetPath: '/repo/docs/a.tsv' })).toMatchObject({
      sheetPath: '/repo/docs/a.tsv',
    });
  });

  it('文字列でなければ受け取らない', () => {
    expect(parseSessionState({ ...base, sheetPath: 12 })).toBeUndefined();
  });

  it('無くてもよい', () => {
    expect(parseSessionState(base)).toMatchObject({ runId: 'r' });
  });
});

describe('parseHumanInput — 人がなぞる（スワイプ / フリック）', () => {
  const swipe = {
    kind: 'swipe',
    caseNo: 1,
    from: { x: 540, y: 2000 },
    to: { x: 540, y: 400 },
    durationMs: 120,
  };

  it('なぞった始点・終点・かかった時間を受け取る', () => {
    expect(parseHumanInput(swipe)).toEqual(swipe);
  });

  it('座標が欠けていたら受け取らない', () => {
    expect(parseHumanInput({ ...swipe, to: { x: 540 } })).toBeUndefined();
  });

  it('時間が 1 ms 未満・長すぎるものは受け取らない', () => {
    expect(parseHumanInput({ ...swipe, durationMs: 0 })).toBeUndefined();
    expect(parseHumanInput({ ...swipe, durationMs: 60_000 })).toBeUndefined();
  });
});

describe('parseHumanInput — 長押し', () => {
  const press = { kind: 'longPress', caseNo: 1, x: 540, y: 1200, durationMs: 700 };

  it('押し続けた時間つきで受け取る', () => {
    expect(parseHumanInput(press)).toEqual(press);
  });

  it('短すぎる長押しは受け取らない（タップとの区別が付かない）', () => {
    expect(parseHumanInput({ ...press, durationMs: 100 })).toBeUndefined();
  });
});

describe('parseHumanInput — 文字を送る', () => {
  it('ASCII の文字列を受け取る', () => {
    expect(parseHumanInput({ kind: 'text', caseNo: 2, text: 'hello' })).toEqual({
      kind: 'text',
      caseNo: 2,
      text: 'hello',
    });
  });

  it('**非 ASCII は受け取らない**（端末の入力は IME を通らない）', () => {
    expect(parseHumanInput({ kind: 'text', caseNo: 2, text: 'あいうえお' })).toBeUndefined();
  });

  it('空の文字列は受け取らない', () => {
    expect(parseHumanInput({ kind: 'text', caseNo: 2, text: '' })).toBeUndefined();
  });

  it('長すぎる文字列は受け取らない', () => {
    expect(parseHumanInput({ kind: 'text', caseNo: 2, text: 'a'.repeat(2000) })).toBeUndefined();
  });
});

describe('parseSessionState — 映像が止まった理由', () => {
  const base = { runId: 'r', phase: 'running', cases: [] };

  it('理由を持てる（黙って真っ黒にしない）', () => {
    expect(parseSessionState({ ...base, liveError: '端末の画面が消えている' })).toMatchObject({
      liveError: '端末の画面が消えている',
    });
  });

  it('文字列でなければ受け取らない', () => {
    expect(parseSessionState({ ...base, liveError: 5 })).toBeUndefined();
  });
});

/**
 * **鑑賞モード**（2026-09-11・人の指示）。
 *
 * > 人はぼーっとみながら AI のテストを鑑賞します。……途中で止められる配慮も必要です。
 *
 * 人が判定を置かなくても先へ進む。**だから「止める」を、ちゃんと口として持つ。**
 * 見ているだけの人が、止めたいときに止められないのは、見ているだけより悪い。
 */
describe('parseHumanInput — 止める', () => {
  it('止める指示を受け取る', () => {
    expect(parseHumanInput({ kind: 'stop', caseNo: 3 })).toEqual({ kind: 'stop', caseNo: 3 });
  });

  /** **宛先のないものは受け取らない**（他の打鍵と同じ扱い）。 */
  it('ケース番号が無ければ受け取らない', () => {
    expect(parseHumanInput({ kind: 'stop' })).toBeUndefined();
  });
});

describe('parseSessionState — 鑑賞中', () => {
  it('鑑賞中という段を受け取る', () => {
    const state = parseSessionState({
      runId: '20260911-190000',
      phase: 'watching',
      cases: [{ no: 1, title: '起動する' }],
    });

    expect(state?.phase).toBe('watching');
  });
});

describe('parseSessionState — 鑑賞の案内', () => {
  /** **人が押さなくても進むことを、画面に出し続ける**ための値。 */
  it('間の長さを受け取る', () => {
    const state = parseSessionState({
      runId: '20260911-190000',
      phase: 'watching',
      watch: { pauseMs: 4000 },
      cases: [{ no: 1, title: '起動する' }],
    });

    expect(state?.watch).toEqual({ pauseMs: 4000 });
  });

  /** **形のおかしいものは持たない。**当て推量で埋めると、画面が嘘の長さを出す。 */
  it('形がおかしければ持たない', () => {
    const state = parseSessionState({
      runId: '20260911-190000',
      phase: 'watching',
      watch: { pauseMs: '4 秒' },
      cases: [{ no: 1, title: '起動する' }],
    });

    expect(state?.watch).toBeUndefined();
  });
});

/**
 * **判定する人に、手順も期待結果も渡っていなかった**（外部レビュー meta-taro/git-qa#19）。
 *
 * > 人は、AI の判定範囲よりも、どう操作する。と、それをすることの意図が読みたいので。
 * > 「AI はここまでしかできません」という文章を読んでも、
 * > は？ この検証の意味が分からないけど
 *
 * 運んでいたのは `no` と `title` だけ。**画面が出したくても持っていなかった。**
 *
 * **列名は決め打ちしない。**`No.` と `項目` 以外は、**シートを書いた人の言葉のまま**運ぶ。
 * 決め打ちにすると、書き手が足した「なぜ見るのか」のような列が届かない ——
 * **届かない設計になっていたのが、そもそもの筋悪だった。**
 */
describe('SessionCase — シートの中身を運ぶ', () => {
  const caseWith = (fields: unknown): unknown => ({
    runId: '20260915-120000',
    phase: 'waiting',
    cases: [{ no: 1, title: 'ボタンを押すと反応する', fields }],
  });

  it('列の名前と値を、並び順のまま運ぶ', () => {
    const state = parseSessionState(
      caseWith([
        { label: '手順', value: '「実行」をクリックする' },
        { label: '期待結果', value: '結果の表が出る' },
      ]),
    );

    expect(state?.cases[0]?.fields).toEqual([
      { label: '手順', value: '「実行」をクリックする' },
      { label: '期待結果', value: '結果の表が出る' },
    ]);
  });

  /** **書き手が足した列も、そのまま届く**（提案 3）。運ぶ側が列名を知っている必要は無い。 */
  it('知らない列も、そのまま運ぶ', () => {
    const state = parseSessionState(
      caseWith([{ label: 'なぜ見るのか', value: 'ボタン側か問い合わせ側かを分けるための対照' }]),
    );

    expect(state?.cases[0]?.fields?.[0]?.label).toBe('なぜ見るのか');
  });

  /** **形の違うものは受け取らない**（黙って半端な欄を画面に出さない）。 */
  it('形が違えば、その欄は落とす', () => {
    const state = parseSessionState(caseWith([{ label: '手順' }, { value: '値だけ' }, '文字']));

    expect(state?.cases[0]?.fields).toBeUndefined();
  });

  it('無ければ持たない（今までのシートも動く）', () => {
    const state = parseSessionState({
      runId: '20260915-120000',
      phase: 'waiting',
      cases: [{ no: 1, title: 'ボタンを押すと反応する' }],
    });

    expect(state?.cases[0]?.fields).toBeUndefined();
  });
});
