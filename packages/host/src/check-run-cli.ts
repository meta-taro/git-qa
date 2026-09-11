import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { compareSheet, renderSheetCheck } from '@git-qa/core';
import type { CheckedRun } from '@git-qa/core';

import { fromInvocationDir } from './paths.js';

/**
 * 証跡が、**何に対して置かれたのか**を確かめる（外部レビュー meta-taro/git-qa#1）。
 *
 *   pnpm check:run runs/20260908-101500/run.json
 *
 * 2026-09-11 まで、シートの `sha256` は書く側が 4 箇所あるのに**読む側が 0 件**で、
 * 型のコメントだけが「突き合わせで分かる」と言っていた。**意図を書くだけにしない。**
 *
 * **ここは配線なので検査していない。**判断のある所（突き合わせと、出す文）は
 * `@git-qa/core` の `sheet-check.ts` にあり、そちらは検査してある。
 */

const runJsonPath = process.argv[2];
if (runJsonPath === undefined) {
  console.error('使い方: pnpm check:run <runs/日時/run.json>');
  process.exit(2);
}

const resolvedRun = fromInvocationDir(runJsonPath);

let run: CheckedRun;
try {
  run = JSON.parse(await readFile(resolvedRun, 'utf8')) as CheckedRun;
} catch {
  // 積み上がったスタックではなく、人が次に何をすればよいかが分かる形で出す。
  console.error(`[git-qa] 証跡を読めない: ${resolvedRun}`);
  process.exit(1);
}

if (run.sheet?.sha256 === undefined || run.sheet.path === undefined) {
  console.error(`[git-qa] 証跡にシートの記録が無い: ${resolvedRun}`);
  process.exit(1);
}

/**
 * シートの場所は証跡に**そのとき打った形**で入っている。
 * 絶対パスならそのまま、相対なら**証跡の隣**を基準にする（`runs/<日時>/` の 2 つ上が作業場）。
 */
const sheetPath = isAbsolute(run.sheet.path)
  ? run.sheet.path
  : resolve(dirname(resolvedRun), '..', '..', run.sheet.path);

const current = await readFile(sheetPath, 'utf8').catch(() => undefined);

const check = compareSheet(run.sheet, current);
console.log(renderSheetCheck(run, check));

/**
 * **同じでなければ 1 で落とす。**人が気づかずに次へ進まないように。
 * 「変わっていた」と分かったうえで進むのは人の判断で、そこはこちらで塞がない。
 */
process.exit(check.kind === 'same' ? 0 : 1);
