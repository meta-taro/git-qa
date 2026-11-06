import { isValidHandle } from '@git-qa/core/session';

/**
 * **外から「このシートのこのケースを確かめてくれ」と呼ばれる口**（C112・2026-11-06）。
 *
 *   git-qa://run?sheet=<検証シートの絶対パス>&case=<No.>&target=<見る相手>
 *
 * 漏れを並べる側の道具（tadori）が、画面のアイコンから git-qa を呼ぶ。人が ○× を置くのは
 * これまでどおり git-qa の画面。**呼ぶ側は始めるだけで、結果は証跡（`run.json`）を読む。**
 *
 * **受け取った文字列をそのまま信用しない**（§21）。OS に登録したスキームは、どのアプリからでも
 * 開ける。シートは絶対パスの TSV、No. は 1 以上の整数、相手は URL・`app:名前`・端末の serial の
 * どれかの形でなければ受け取らない。**受け取らなかった理由は画面に出す**（黙って何も起きない、を作らない）。
 */

export interface LaunchRequest {
  /** 検証シート（TSV）の絶対パス。 */
  readonly sheetPath: string;
  /** シートの `No.`。付けるとそのケースだけ走る。省くとシート全部。 */
  readonly caseNo?: number;
  /** 見る相手。`https://…`・`app:名前`・端末の serial。省くと画面で選ぶ所で止まる。 */
  readonly target?: string;
}

export type ParsedLaunch =
  | { readonly ok: true; readonly request: LaunchRequest }
  | { readonly ok: false; readonly reason: string };

/** `/Users/…` か `C:\…`。**相対は受け取らない**（配布版の作業ディレクトリは `/`）。 */
const isAbsolute = (path: string): boolean => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);

/** `app:名前`（デスクトップ）・`https://…`（ウェブ）・端末の serial。 */
function targetReason(target: string): string | undefined {
  if (/^https?:\/\//.test(target)) {
    try {
      new URL(target);
      return undefined;
    } catch {
      return `target の URL が読めない: ${target}`;
    }
  }
  if (target.startsWith('app:')) {
    return target.slice(4).trim() === '' ? 'target の app: の後ろにアプリ名が無い' : undefined;
  }
  // adb の serial（`emulator-5554`・`192.168.0.2:5555`・英数字）。
  return /^[A-Za-z0-9._:-]{1,64}$/.test(target)
    ? undefined
    : `target は https://…・app:名前・端末の serial のどれか: ${target}`;
}

export function parseLaunchUrl(raw: string): ParsedLaunch {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `URL として読めない: ${raw}` };
  }
  if (url.protocol !== 'git-qa:') return { ok: false, reason: `git-qa:// ではない: ${raw}` };
  if (url.host !== 'run') return { ok: false, reason: `知らない動作（run だけ）: ${url.host}` };

  const sheet = url.searchParams.get('sheet')?.trim() ?? '';
  if (sheet === '') return { ok: false, reason: 'sheet（検証シートの絶対パス）が無い' };
  if (!isAbsolute(sheet)) return { ok: false, reason: `sheet は絶対パス: ${sheet}` };
  if (/(^|[\\/])\.\.([\\/]|$)/.test(sheet))
    return { ok: false, reason: `sheet に .. が入っている: ${sheet}` };
  if (!/\.tsv$/i.test(sheet)) return { ok: false, reason: `sheet は TSV: ${sheet}` };

  const rawCase = url.searchParams.get('case');
  let caseNo: number | undefined;
  if (rawCase !== null && rawCase.trim() !== '') {
    const no = /^[0-9]+$/.test(rawCase.trim()) ? Number(rawCase.trim()) : undefined;
    if (no === undefined || no < 1)
      return { ok: false, reason: `case は 1 以上の整数: ${rawCase}` };
    caseNo = no;
  }

  const rawTarget = url.searchParams.get('target')?.trim();
  let target: string | undefined;
  if (rawTarget !== undefined && rawTarget !== '') {
    const reason = targetReason(rawTarget);
    if (reason !== undefined) return { ok: false, reason };
    target = rawTarget;
  }

  return {
    ok: true,
    request: {
      sheetPath: sheet,
      ...(caseNo === undefined ? {} : { caseNo }),
      ...(target === undefined ? {} : { target }),
    },
  };
}

/** 画面が覚えているもの（毎回打たせない値）。 */
export interface Remembered {
  readonly operator: string;
  readonly browser: string;
  readonly browserPath: string;
}

export interface LaunchStartParams {
  readonly serial: string;
  readonly sheetPath: string;
  readonly operator: string;
  readonly browser: string;
  readonly browserPath?: string;
  readonly caseNo?: number;
}

/**
 * 始められないなら、その理由（文言の鍵）。**揃っていれば `undefined`。**
 *
 * 相手が無ければ画面で選ぶ所で止まる。ハンドルが無ければ**誰が置いたか分からない証跡**になるので始めない。
 */
export function whyCannotLaunch(
  request: LaunchRequest,
  operator: string,
):
  | 'setup.blocked.device'
  | 'setup.blocked.operator.empty'
  | 'setup.blocked.operator.bad'
  | undefined {
  if (request.target === undefined) return 'setup.blocked.device';
  if (operator.trim() === '') return 'setup.blocked.operator.empty';
  if (!isValidHandle(operator.trim())) return 'setup.blocked.operator.bad';
  return undefined;
}

/** 入口サーバへ渡す形。**始められないときは `undefined`**（理由は `whyCannotLaunch`）。 */
export function launchParams(
  request: LaunchRequest,
  remembered: Remembered,
): LaunchStartParams | undefined {
  if (whyCannotLaunch(request, remembered.operator) !== undefined) return undefined;
  const target = request.target as string;
  const browserPath = remembered.browserPath.trim();
  return {
    serial: target,
    sheetPath: request.sheetPath,
    operator: remembered.operator.trim(),
    browser: remembered.browser,
    ...(remembered.browser === 'other' && browserPath !== '' ? { browserPath } : {}),
    ...(request.caseNo === undefined ? {} : { caseNo: request.caseNo }),
  };
}
