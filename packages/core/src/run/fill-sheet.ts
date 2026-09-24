/**
 * **正本のシートに、誰がいつ確かめたかを書き戻す**（2026-09-24・人の判断）。
 *
 * > だれがいつどう検査したか正本が更新されないなら、なにが便利なんですか？
 * > git-qa といった名前や、md-business も git 管理がすべてです。
 * > **直接つど更新することがのぞましい**と、わたしは現時点で判断しています。
 *
 * **C3（TSV へ書き戻さない）を覆した。**
 * C3 の理由は「同じシートを何機体でも走らせるので、書くと 1 枚が 1 機体に縛られる」だった。
 * **その前提が実物と食い違っていた** —— md-business が作る実物のシートは、最初から
 * `結果 / 実施日 / 担当` を持っている。**書き込まれる前提の形式だった。**
 * **上書きしても git に前の版が残る**（人の判断）。
 *
 * **絶対に守る線が 1 つ。**
 *
 * > **AI が出しただけの判定は書かない。**
 *
 * `product-baseline.md` §19「合否は実物を見た人が記入する。**AI が代筆・要約しない**」。
 * `AUTO_PASS` は「**人は見ていない**」なので、**書けば嘘になる。**
 */

/** 実物のシートが持っている列（md-business の様式）。 */
export const RESULT_COLUMN = '結果';
const DATE_COLUMN = '実施日';
const BY_COLUMN = '担当';

/** `結果:enum(OK|NG|保留|未実施)!` のような宣言から、列の名前だけを取る。 */
const columnName = (declared: string): string =>
  (declared.split(':')[0] ?? '').replace(/!$/, '').trim();

/**
 * 人が置いた判定を、シートの言葉へ移す。
 *
 * **`AUTO_PASS` と `SKIP` は書かない。**
 * 前者は**人が見ていない**、後者は**「今回は見ない」で結果ではない。**
 */
const asSheetResult = (result: string): string | undefined => {
  if (result === 'VERIFIED') return 'OK';
  if (result === 'FAIL') return 'NG';
  if (result === 'BLOCKED') return '保留';
  return undefined;
};

export interface FilledCase {
  readonly no: number;
  readonly result: string;
  /** 置いた人。**無ければ人が置いていない**ので書かない。 */
  readonly verifiedBy?: string;
}

export interface FillSheetOptions {
  readonly cases: readonly FilledCase[];
  /** 実施日（`YYYY-MM-DD`）。 */
  readonly date: string;
}

export interface FilledSheet {
  readonly text: string;
  /** 実際に書いた行の数。 */
  readonly filled: number;
  /** シートに見つからなかった `No.`。**黙って飛ばさない。** */
  readonly missed: readonly number[];
  /** 書かなかったときの理由。 */
  readonly why?: string;
}

/**
 * シートの本文を作り直す。**書く列以外は 1 文字も触らない。**
 *
 * **置いていない行はそのまま残す** —— 途中で止めた実行で、
 * **走っていない行を「未実施」から動かさない。**
 */
export function fillSheetResults(text: string, options: FillSheetOptions): FilledSheet {
  const lines = text.split('\n');
  const headerAt = lines.findIndex((line) => line.startsWith('No.'));
  if (headerAt < 0) {
    return { text, filled: 0, missed: [], why: '列の見出し（No. で始まる行）が見つからない' };
  }

  const columns = (lines[headerAt] ?? '').split('\t').map(columnName);
  const resultAt = columns.indexOf(RESULT_COLUMN);
  if (resultAt < 0) {
    // **列を足さない。**シートの形を勝手に変えない。
    return {
      text,
      filled: 0,
      missed: [],
      why: `このシートには「${RESULT_COLUMN}」の列が無いので書けない（列は足さない）`,
    };
  }
  const dateAt = columns.indexOf(DATE_COLUMN);
  const byAt = columns.indexOf(BY_COLUMN);

  /** 人が置いたものだけを、行番号で引けるようにする。 */
  const byNo = new Map<number, { result: string; verifiedBy: string }>();
  for (const one of options.cases) {
    const said = asSheetResult(one.result);
    // **人が置いていないものは書かない。**`verifiedBy` が無いものは AI の判定。
    if (said === undefined || one.verifiedBy === undefined) continue;
    byNo.set(one.no, { result: said, verifiedBy: one.verifiedBy });
  }

  let filled = 0;
  const found = new Set<number>();
  const out = lines.map((line, at) => {
    if (at <= headerAt || line.trim() === '' || line.startsWith('#')) return line;
    const cells = line.split('\t');
    const no = Number((cells[0] ?? '').trim());
    if (!Number.isInteger(no)) return line;
    const hit = byNo.get(no);
    if (hit === undefined) return line;

    found.add(no);
    // **足りない列は作らない。**在る列だけ埋める。
    const next = [...cells];
    while (next.length < columns.length) next.push('');
    next[resultAt] = hit.result;
    if (dateAt >= 0) next[dateAt] = options.date;
    if (byAt >= 0) next[byAt] = hit.verifiedBy;
    filled += 1;
    return next.join('\t');
  });

  /**
   * **全部に人の判定が付いたときだけ、見出しの状態を変える。**
   * 途中で止めた実行で「実施済み」と書くと、**シートが嘘をつく。**
   */
  const rows = lines.filter(
    (line, at) => at > headerAt && line.trim() !== '' && !line.startsWith('#'),
  ).length;
  const done = filled > 0 && filled === rows;

  const withStatus = done
    ? out.map((line) => (line.startsWith('# ステータス:') ? '# ステータス: 実施済み' : line))
    : out;

  return {
    text: withStatus.join('\n'),
    filled,
    missed: [...byNo.keys()].filter((no) => !found.has(no)),
  };
}

/**
 * **正本のシートへ書き戻す**（2026-09-24・人の判断）。
 *
 * > git 管理されたものが壊れるのをなぜ気にするのですか？
 * > また md-business は壊れた tsv を修復できます。**役割を分担してください。**
 *
 * **守りを重ねない。**
 *
 * | 誰の仕事 | 何 |
 * |---|---|
 * | git | 前の版を残す |
 * | md-business | 様式を作る・壊れたものを直す |
 * | **git-qa** | **人が置いた判定を書く** |
 *
 * **こちらが守るのは 1 つだけ** —— **AI が出しただけの判定を書かない**（§19）。
 * **それはこの製品の芯**なので、他の道具は持っていない。
 *
 * **落ちない。**書けなくても証跡（`run.json`）は既に残っている。理由を返すだけ。
 */
export async function writeBackToSheet(run: {
  readonly sheet: { readonly path: string };
  readonly startedAt: string;
  readonly cases: readonly { no: number; result: string; verifiedBy?: string }[];
}): Promise<FilledSheet> {
  const { readFile, writeFile } = await import('node:fs/promises');

  let text: string;
  try {
    text = await readFile(run.sheet.path, 'utf8');
  } catch (error: unknown) {
    const said = error instanceof Error ? error.message : String(error);
    return { text: '', filled: 0, missed: [], why: `シートを読めなかった: ${said}` };
  }

  const filled = fillSheetResults(text, {
    cases: run.cases.map((one) => ({
      no: one.no,
      result: one.result,
      ...(one.verifiedBy === undefined ? {} : { verifiedBy: one.verifiedBy }),
    })),
    date: (run.startedAt.split('T')[0] ?? '').trim(),
  });

  if (filled.filled === 0) return filled;

  try {
    await writeFile(run.sheet.path, filled.text, 'utf8');
  } catch (error: unknown) {
    const said = error instanceof Error ? error.message : String(error);
    return { ...filled, filled: 0, why: `シートへ書けなかった: ${said}` };
  }
  return filled;
}
