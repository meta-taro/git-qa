import { readFile } from 'node:fs/promises';

import { TsvParseError } from './errors.js';
import type { TestSpecSheet, TsvColumn, TsvColumnType, TsvDirective, TsvRow } from './types.js';

/** 1 行目に必ず居る宣言。行頭 0 桁でないと md-business のグリッドに載らない。 */
const MAGIC_PREFIX = '#!';

/** `#@ <種別> <値>` の宣言行 */
const DIRECTIVE_PREFIX = '#@';

/**
 * 検証シート TSV を読む。**書き戻す口はこのモジュールに無い**（decisions.md C3）。
 *
 * 結果の記入は md-business 側の役目で、git-qa は行 ID も `computed` も `hidden` も
 * 正しく扱えない。中途半端に書ける口を持つと、いつか誰かがそれを使う。
 */
export function parseTestSpecTsv(text: string): TestSpecSheet {
  // BOM はエディタが勝手に付けることがある。付いていても中身は同じなので落とす。
  // ただし空白・タブは落とさない（行頭 0 桁でなくなった時点で仕様違反なので気づかせる）。
  const body = text.startsWith('﻿') ? text.slice(1) : text;
  const lines = body.split(/\r\n|\n/);

  const first = lines[0];
  if (first === undefined || !first.startsWith(MAGIC_PREFIX)) {
    throw new TsvParseError(
      `1 行目が ${MAGIC_PREFIX} で始まっていない。検証シート TSV ではない可能性がある`,
      1,
    );
  }
  const magic = first.slice(MAGIC_PREFIX.length).trim();

  const meta: Record<string, string> = {};
  const directives: TsvDirective[] = [];
  let columns: TsvColumn[] | undefined;
  const rows: TsvRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const line = i + 1;

    // 末尾の改行で生じる空行、および区切りとして置かれた空行は読み飛ばす。
    if (raw === '') continue;

    if (raw.startsWith(DIRECTIVE_PREFIX)) {
      directives.push(parseDirective(raw, line));
      continue;
    }

    // 見出しブロックの `# キー: 値`。ヘッダ行より後ろに出た `#` 行はデータとして扱う
    // （1 列目が `#` で始まるセルもありうるため、見出し扱いを広げない）。
    if (columns === undefined && raw.startsWith('#')) {
      const rest = raw.slice(1).trim();
      const sep = rest.indexOf(':');
      if (sep === -1) {
        // キーと値に割れない `#` 行は、意味を決められないので捨てずに無視する。
        continue;
      }
      const key = rest.slice(0, sep).trim();
      meta[key] = rest.slice(sep + 1).trim();
      continue;
    }

    if (columns === undefined) {
      columns = parseHeader(raw, line);
      continue;
    }

    rows.push(parseRow(raw, line, rows.length, columns));
  }

  if (columns === undefined) {
    throw new TsvParseError('ヘッダ行が無い');
  }

  return { magic, meta, directives, columns, rows };
}

/** ファイルから読む。読むだけで、書き込みも作成もしない。 */
export async function readTestSpecTsv(path: string): Promise<TestSpecSheet> {
  const text = await readFile(path, 'utf8');
  return parseTestSpecTsv(text);
}

function parseDirective(raw: string, line: number): TsvDirective {
  const rest = raw.slice(DIRECTIVE_PREFIX.length).trim();
  const sep = rest.search(/\s/);
  // 種別を解釈できなくても捨てない。仕様の正本は md-business 側にあり、
  // こちらが知らない宣言（hidden / computed など）を落とすと、
  // あとで「あったはずの宣言が無い」と誤読される。
  const kind = sep === -1 ? rest : rest.slice(0, sep);
  const value = sep === -1 ? '' : rest.slice(sep + 1).trim();
  return { kind, value, raw, line };
}

function parseHeader(raw: string, line: number): TsvColumn[] {
  const fields = raw.split('\t');
  const columns = fields.map((field, index) => parseColumn(field, index, line));

  const seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.name)) {
      // 列名で引く前提なので、重複すると後勝ちで静かに片方が消える。
      throw new TsvParseError(`列名が重複している: ${column.name}`, line);
    }
    seen.add(column.name);
  }
  return columns;
}

function parseColumn(raw: string, index: number, line: number): TsvColumn {
  const required = raw.endsWith('!');
  const withoutRequired = required ? raw.slice(0, -1) : raw;

  const sep = withoutRequired.indexOf(':');
  if (sep === -1) {
    return { name: withoutRequired.trim(), type: { kind: 'text' }, required, raw, index };
  }

  const name = withoutRequired.slice(0, sep).trim();
  const type = parseColumnType(withoutRequired.slice(sep + 1).trim(), line);
  return { name, type, required, raw, index };
}

function parseColumnType(spec: string, line: number): TsvColumnType {
  const enumMatch = /^enum\((.*)\)$/.exec(spec);
  if (enumMatch) {
    const values = (enumMatch[1] ?? '').split('|').map((v) => v.trim());
    return { kind: 'enum', values };
  }

  switch (spec) {
    case 'text':
    case '':
      return { kind: 'text' };
    case 'number':
      return { kind: 'number' };
    case 'date':
      return { kind: 'date' };
    case 'url':
      return { kind: 'url' };
    case 'multiline':
      return { kind: 'multiline' };
    default:
      // 知らない型を text に丸めると、以後その列は「型注釈が無い列」と区別できなくなる。
      throw new TsvParseError(`知らない列の型: ${spec}`, line);
  }
}

function parseRow(raw: string, line: number, index: number, columns: TsvColumn[]): TsvRow {
  const fields = raw.split('\t');

  // 足りない側（末尾の空セル省略）は仕様上許容される。
  // 多い側は区切りが 1 個多いということで、内容が隣の列へずれて入っている。
  if (fields.length > columns.length) {
    throw new TsvParseError(
      `ヘッダは ${columns.length} 列だが、この行は ${fields.length} 列ある`,
      line,
    );
  }

  const cells: Record<string, string> = {};
  const rawCells: Record<string, string> = {};
  for (const column of columns) {
    const value = fields[column.index] ?? '';
    rawCells[column.name] = value;
    cells[column.name] = column.type.kind === 'multiline' ? unescapeMultiline(value) : value;
  }

  return { index, line, cells, rawCells, raw };
}

/**
 * multiline 列のセルを表示用に戻す。
 *
 * 1 レコード = 1 物理行なので、セル内改行は `\n`（円記号 + n）で入っている。
 * text 列などに書かれた `\n` は文字列としての中身であって改行指示ではないため、戻さない。
 *
 * 復元規則の正本は md-business 側にある。ここで扱うのは `\n` だけで、
 * それ以外の並びには触らない。突き合わせが要る場合のために原文は `rawCells` に残す。
 */
function unescapeMultiline(value: string): string {
  return value.replace(/\\n/g, '\n');
}
