/**
 * **AI エージェントへ、この道具の説明を渡す**（2026-09-10・人の指示）。
 *
 * > MCP にこのソフト概要みたいなのを AI エージェント向けに出力するやつ設置したいです。
 * > バージョンごとになにが変わったかも返すように。
 *
 * **概要も変更履歴も、文書を正本にして読み出す。**ここに文字列を埋めると、
 * 文書と実装がずれる（product-baseline §10「古い文書は、無い文書より悪い」）。
 * この段はその 2 つを読んで組み立てるだけで、**中身を書き換えない。**
 */

/** 版 1 つ分の記録。**日付は無いことがある**（未リリースの見出しなど）。 */
export interface ChangelogEntry {
  readonly version: string;
  readonly date?: string;
  readonly changes: readonly string[];
}

/** `## 0.1.0 — 2026-09-08` / `## 未リリース` */
const HEADING = /^##\s+(?<version>[^—\-\s][^—]*?)\s*(?:—\s*(?<date>\S+))?\s*$/;
/** `- 足した: …` */
const BULLET = /^[-*]\s+(?<change>.+?)\s*$/;

/**
 * 変更の記録を、版ごとに割る。
 *
 * **並べ替えない。**書いた人が置いた順（普通は新しい順）が、そのまま意味を持つ。
 * **無い版をでっち上げない** —— 見出しが 1 つも無ければ空を返す。
 */
export function parseChangelog(markdown: string): ChangelogEntry[] {
  const found: { version: string; date?: string; changes: string[] }[] = [];

  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading?.groups) {
      const version = heading.groups['version']?.trim() ?? '';
      const date = heading.groups['date']?.trim();
      if (version === '') continue;
      found.push({ version, ...(date === undefined ? {} : { date }), changes: [] });
      continue;
    }

    const bullet = BULLET.exec(line);
    const current = found.at(-1);
    // 見出しより前の箇条書きは、どの版の話か分からない。**当て推量で最初の版へ入れない。**
    if (bullet?.groups === undefined || current === undefined) continue;
    current.changes.push(bullet.groups['change'] as string);
  }

  return found;
}

export interface RenderAboutOptions {
  /** 概要の本文（`docs/agent-brief.md`）。**要約せず、そのまま渡す。** */
  readonly brief: string;
  /** 変更の記録（`CHANGELOG.md`）。**読めなければ `undefined`。** */
  readonly changelog: string | undefined;
  /** 1 つの版だけを聞かれたとき、その版。 */
  readonly version?: string;
}

/**
 * 返す文を組み立てる。
 *
 * **片方が欠けても、もう片方は渡す。**記録が読めないことと、概要が無いことは別。
 * **知らない版を聞かれたら、そう言う** —— 黙って全部返すと、聞いた側が誤る。
 */
export function renderAbout(options: RenderAboutOptions): string {
  const parts: string[] = [options.brief.trimEnd()];

  if (options.changelog === undefined) {
    parts.push(
      '## 変更の記録\n\n**変更の記録が読めなかった。**（`CHANGELOG.md` が無いか、開けない）',
    );
    return parts.join('\n\n');
  }

  const entries = parseChangelog(options.changelog);

  if (options.version !== undefined) {
    const hit = entries.find((entry) => entry.version === options.version);
    if (hit === undefined) {
      parts.push(
        `## 変更の記録\n\n**${options.version} の記録が無い。**` +
          `（あるのは: ${entries.map((e) => e.version).join(' / ')}）`,
      );
      return parts.join('\n\n');
    }
    parts.push(`## 変更の記録\n\n${renderEntry(hit)}`);
    return parts.join('\n\n');
  }

  if (entries.length === 0) {
    parts.push('## 変更の記録\n\n**まだ 1 件も無い。**');
    return parts.join('\n\n');
  }

  parts.push(`## 変更の記録\n\n${entries.map(renderEntry).join('\n\n')}`);
  return parts.join('\n\n');
}

function renderEntry(entry: ChangelogEntry): string {
  const head = entry.date === undefined ? entry.version : `${entry.version}（${entry.date}）`;
  const body =
    entry.changes.length === 0
      ? '（中身が書かれていない）'
      : entry.changes.map((change) => `- ${change}`).join('\n');
  return `### ${head}\n\n${body}`;
}
