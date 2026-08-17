import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { TsvParseError, parseTestSpecTsv, readTestSpecTsv } from '../../src/index.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/sample-notes-app.tsv', import.meta.url));

const readFixture = (): string => readFileSync(FIXTURE, 'utf8');

describe('parseTestSpecTsv — 見出し', () => {
  it('マジック行を読む', () => {
    const sheet = parseTestSpecTsv(readFixture());
    expect(sheet.magic).toBe('md-business:test-spec-tsv/v1');
  });

  it('マジック行が無ければ、行番号付きで落ちる', () => {
    expect(() => parseTestSpecTsv('No.\t項目\r\n1\tあ\r\n')).toThrowError(TsvParseError);
  });

  it('マジック行が行頭 0 桁でなければ落ちる', () => {
    // 先頭に空白が入るとデスクトップアプリのグリッド判定から外れる。
    // 読めてしまうと「アプリでは表にならないのに git-qa では通る」というズレが出る。
    expect(() => parseTestSpecTsv(' #! md-business:test-spec-tsv/v1\r\n')).toThrowError(
      TsvParseError,
    );
  });

  it('メタ行を キー / 値 で読む', () => {
    const sheet = parseTestSpecTsv(readFixture());
    expect(sheet.meta.タイトル).toBe('サンプルメモ帳アプリ 検証シート');
    expect(sheet.meta.文書番号).toBe('TEST-git-qa-001');
    expect(sheet.meta.ステータス).toBe('未実施');
  });

  it('ディレクティブ行を種別ごとに保持する', () => {
    const sheet = parseTestSpecTsv(readFixture());
    const kinds = sheet.directives.map((d) => d.kind);
    expect(kinds).toContain('note');
    expect(kinds).toContain('style');
  });

  it('知らないディレクティブは捨てずに raw のまま持つ', () => {
    // 仕様は md-business 側にあり、こちらは読むだけ。
    // 知らないものを落とすと、あとで「あったはずの宣言が無い」と誤読される。
    const text = readFixture().replace(
      '#@ note git-qa',
      '#@ unknown-directive なにか\r\n#@ note git-qa',
    );
    const sheet = parseTestSpecTsv(text);
    const unknown = sheet.directives.find((d) => d.kind === 'unknown-directive');
    expect(unknown?.raw).toBe('#@ unknown-directive なにか');
  });
});

describe('parseTestSpecTsv — 壊れたシートを通さない', () => {
  it('ヘッダ行が無ければ落ちる', () => {
    expect(() =>
      parseTestSpecTsv('#! md-business:test-spec-tsv/v1\r\n# タイトル: あ\r\n'),
    ).toThrowError(/ヘッダ行/);
  });

  it('列名が重複していたら落ちる', () => {
    // 列名で引く前提なので、重複すると後勝ちで静かに片方が消える。
    const text = readFixture().replace('担当\t関連Issue:url', '区分\t関連Issue:url');
    expect(() => parseTestSpecTsv(text)).toThrowError(/区分/);
  });

  it('知らない列の型は落ちる（text に丸めない）', () => {
    // text に丸めると、以後その列は「型注釈が無い列」と区別できなくなる。
    const text = readFixture().replace('実施日:date', '実施日:datetime');
    expect(() => parseTestSpecTsv(text)).toThrowError(/datetime/);
  });

  it('キーと値に割れない # 行は、メタとして取り込まない', () => {
    const text = readFixture().replace('# 版: 0.1.0', '# 版 0.1.0');
    const sheet = parseTestSpecTsv(text);
    expect(sheet.meta).not.toHaveProperty('版');
    expect(sheet.meta.文書番号).toBe('TEST-git-qa-001');
  });
});

describe('parseTestSpecTsv — ヘッダの列定義', () => {
  it('列名・型・必須フラグを分解する', () => {
    const sheet = parseTestSpecTsv(readFixture());
    const byName = Object.fromEntries(sheet.columns.map((c) => [c.name, c]));

    expect(byName['No.']).toMatchObject({ required: true, type: { kind: 'number' } });
    expect(byName['区分']).toMatchObject({ required: false, type: { kind: 'text' } });
    expect(byName['手順']).toMatchObject({ required: true, type: { kind: 'multiline' } });
    expect(byName['実施日']).toMatchObject({ required: false, type: { kind: 'date' } });
    expect(byName['関連Issue']).toMatchObject({ required: false, type: { kind: 'url' } });
  });

  it('enum の候補を取り出す', () => {
    const sheet = parseTestSpecTsv(readFixture());
    const result = sheet.columns.find((c) => c.name === '結果');
    expect(result?.type).toEqual({ kind: 'enum', values: ['OK', 'NG', '保留', '未実施'] });
  });

  it('列定義の原文を残す', () => {
    const sheet = parseTestSpecTsv(readFixture());
    const result = sheet.columns.find((c) => c.name === '結果');
    expect(result?.raw).toBe('結果:enum(OK|NG|保留|未実施)!');
  });
});

describe('parseTestSpecTsv — 行', () => {
  it('全行を列名で引ける', () => {
    const sheet = parseTestSpecTsv(readFixture());
    expect(sheet.rows).toHaveLength(5);
    expect(sheet.rows[0]?.cells['項目']).toBe('アプリが起動する');
    expect(sheet.rows[2]?.cells['期待結果']).toBe(
      '「本文を入力してください」と表示され、保存されない',
    );
  });

  it('multiline 列の \\n を実改行に戻す', () => {
    const sheet = parseTestSpecTsv(readFixture());
    expect(sheet.rows[1]?.cells['手順']).toBe(
      '1. + をタップする\n2. 本文に「あいうえお」と入力する\n3. 保存をタップする',
    );
  });

  it('multiline 以外の列では \\n を実改行に戻さない', () => {
    // text 列に入った \n は文字列としての中身であって、改行指示ではない。
    const text = readFixture().replace('日本語で検索できる', 'a\\nb');
    const sheet = parseTestSpecTsv(text);
    expect(sheet.rows[3]?.cells['項目']).toBe('a\\nb');
  });

  it('原文セルも保持する（復元前の値で突き合わせたいとき用）', () => {
    const sheet = parseTestSpecTsv(readFixture());
    expect(sheet.rows[1]?.rawCells['手順']).toContain('\\n');
  });

  it('末尾の空セルを省略した短い行を、空文字で埋めて読む', () => {
    const sheet = parseTestSpecTsv(readFixture());
    const last = sheet.rows[4];
    expect(last?.cells['項目']).toBe('メモを削除できる');
    expect(last?.cells['担当']).toBe('');
    expect(last?.cells['備考']).toBe('');
  });

  it('列数が超過した行は、行番号付きで落ちる', () => {
    // 足りない側は仕様上許容されるが、多い側は「区切りが 1 個多い」＝壊れている。
    // ヘッダ 10 列に対して 11 列の行を作る。
    const text = readFixture().replace('4\t検索', '4\t検索\tはみ出し');
    expect(() => parseTestSpecTsv(text)).toThrowError(/11 列/);
  });

  it('物理行番号を持つ（エラー報告と md-business への突き合わせに使う）', () => {
    const sheet = parseTestSpecTsv(readFixture());
    // 1 行目マジック + メタ 6 + ディレクティブ 2 + ヘッダ 1 = 10 行目までが見出し
    expect(sheet.rows[0]?.line).toBe(11);
    expect(sheet.rows[4]?.line).toBe(15);
  });
});

describe('readTestSpecTsv — 読むだけで書き換えない（C3）', () => {
  it('読んでもファイルが 1 バイトも変わらない', async () => {
    const before = createHash('sha256').update(readFileSync(FIXTURE)).digest('hex');
    await readTestSpecTsv(FIXTURE);
    const after = createHash('sha256').update(readFileSync(FIXTURE)).digest('hex');
    expect(after).toBe(before);
  });

  it('CRLF の fixture を、改行を書き換えずに読む', () => {
    // git 側の変換で LF になっていたら、この時点で気づけるようにする（.gitattributes）。
    expect(readFileSync(FIXTURE, 'utf8')).toContain('\r\n');
  });

  it('ファイルから読んでも、文字列から読んだのと同じ結果になる', async () => {
    const fromFile = await readTestSpecTsv(FIXTURE);
    const fromText = parseTestSpecTsv(readFixture());
    expect(fromFile.rows).toEqual(fromText.rows);
  });
});
