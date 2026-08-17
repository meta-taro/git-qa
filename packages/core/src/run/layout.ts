import { join } from 'node:path';

/** `runs/<runId>/<caseId>/` の名前の付け方をここに閉じる。 */

/** runId は外から渡ってくる。素通しでディレクトリを掘ると runs/ の外へ書ける口になる。 */
const SAFE_RUN_ID = /^[A-Za-z0-9._-]+$/;

export function runDir(runsRoot: string, runId: string): string {
  if (!SAFE_RUN_ID.test(runId) || runId === '.' || runId === '..') {
    throw new Error(`runId に使えない文字が含まれている: ${JSON.stringify(runId)}`);
  }
  return join(runsRoot, runId);
}

export function runJsonPath(runsRoot: string, runId: string): string {
  return join(runDir(runsRoot, runId), 'run.json');
}

/** ケース番号は 3 桁ゼロ埋め。揃えないと ls でもファイラでも番号順に並ばない。 */
export function caseDirName(caseNo: number): string {
  if (!Number.isInteger(caseNo) || caseNo < 1) {
    throw new Error(`ケース番号は 1 以上の整数でなければならない: ${caseNo}`);
  }
  return `case-${String(caseNo).padStart(3, '0')}`;
}

export function caseDir(runsRoot: string, runId: string, caseNo: number): string {
  return join(runDir(runsRoot, runId), caseDirName(caseNo));
}
