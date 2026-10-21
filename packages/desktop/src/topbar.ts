import type { SessionCase, SessionPhase } from '@git-qa/core/session';

import { t } from './i18n/current.js';
import { keyCap } from './session/keys.js';

/**
 * **上の帯**（2026-10-21・DESIGN.md「上の帯」）。
 *
 * 何を・何で見ていて、どこまで済んで、**いま誰の番か**を 1 行で出す。
 * 3 つのカラムのどれを見ていても、ここだけは目に入る。
 *
 * **持っていない値は出さない。**端末やシートが分からない起動の仕方（ターミナルから映像だけ繋いだ等）では、
 * その欄ごと出さない。空の欄は「消えた」ように見える。
 */

export type TopbarPhase = 'setup' | SessionPhase;

export interface TopbarInfo {
  readonly phase: TopbarPhase;
  readonly sheetPath?: string;
  /** 見ている相手（端末の serial・URL・アプリ名）。 */
  readonly target?: string;
  /** 判定を置く人のハンドル。 */
  readonly operator?: string;
  readonly cases?: readonly SessionCase[];
}

const SVG = 'http://www.w3.org/2000/svg';

/** アイコンと同じ形（端末の枠の中のチェック）。**飾りなので読ませない。** */
function brandMark(doc: Document): HTMLElement {
  const box = doc.createElement('span');
  box.className = 'topbar-mark';
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const frame = doc.createElementNS(SVG, 'rect');
  for (const [k, v] of Object.entries({ x: '5', y: '2.5', width: '14', height: '19', rx: '2.5' })) {
    frame.setAttribute(k, v);
  }
  const check = doc.createElementNS(SVG, 'path');
  check.setAttribute('d', 'M9 12l2.2 2.2L15.5 10');
  svg.append(frame, check);
  box.append(svg);
  return box;
}

/** パスの最後の 2 段。**長いパスで帯を埋めない**（全部は title で読める）。 */
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== '');
  return parts.slice(-2).join('/');
}

export interface Progress {
  readonly placed: number;
  readonly total: number;
  readonly verified: number;
  readonly auto: number;
  readonly failed: number;
  readonly skipped: number;
}

/** 結果ごとの数。**BLOCKED は FAIL と同じ「止まった」側に数える**（帯では細かく分けない）。 */
export function progressOf(cases: readonly SessionCase[]): Progress {
  const count = (...results: string[]): number =>
    cases.filter((c) => c.result !== undefined && results.includes(c.result)).length;
  return {
    placed: cases.filter((c) => c.result !== undefined).length,
    total: cases.length,
    verified: count('VERIFIED'),
    auto: count('AUTO_PASS'),
    failed: count('FAIL', 'BLOCKED'),
    skipped: count('SKIP'),
  };
}

function progressBar(doc: Document, progress: Progress): HTMLElement {
  const box = doc.createElement('div');
  box.className = 'topbar-progress';

  const bar = doc.createElement('div');
  bar.className = 'progress-bar';
  bar.setAttribute('role', 'img');
  bar.setAttribute(
    'aria-label',
    t('topbar.progress', { placed: String(progress.placed), total: String(progress.total) }),
  );
  const parts: [string, number][] = [
    ['verified', progress.verified],
    ['auto', progress.auto],
    ['failed', progress.failed],
    ['skipped', progress.skipped],
  ];
  for (const [kind, n] of parts) {
    if (n === 0 || progress.total === 0) continue;
    const seg = doc.createElement('span');
    seg.className = `progress-seg progress-${kind}`;
    seg.style.width = `${String((n / progress.total) * 100)}%`;
    bar.append(seg);
  }

  const count = doc.createElement('span');
  count.className = 'topbar-count';
  count.textContent = `${String(progress.placed)} / ${String(progress.total)}`;

  box.append(bar, count);
  return box;
}

const PHASE_KEYS = {
  setup: 'topbar.phase.setup',
  running: 'topbar.phase.running',
  waiting: 'topbar.phase.waiting',
  watching: 'topbar.phase.watching',
  finished: 'topbar.phase.finished',
} as const;

export function renderTopbar(bar: HTMLElement, info: TopbarInfo): void {
  const doc = bar.ownerDocument;
  bar.replaceChildren();
  bar.dataset['phase'] = info.phase;

  const brand = doc.createElement('div');
  brand.className = 'topbar-brand';
  const name = doc.createElement('span');
  name.textContent = 'git-qa';
  brand.append(brandMark(doc), name);
  bar.append(brand);

  // 何を・何で。**分かるものだけ並べる。**
  const crumbs = [
    info.sheetPath === undefined
      ? undefined
      : { text: shortPath(info.sheetPath), title: info.sheetPath },
    info.target === undefined || info.target === ''
      ? undefined
      : { text: info.target, title: info.target },
  ].filter((c) => c !== undefined);
  if (crumbs.length > 0) {
    const crumb = doc.createElement('div');
    crumb.className = 'topbar-crumb';
    crumbs.forEach((c, i) => {
      if (i > 0) {
        const sep = doc.createElement('span');
        sep.className = 'topbar-sep';
        sep.setAttribute('aria-hidden', 'true');
        sep.textContent = '/';
        crumb.append(sep);
      }
      const part = doc.createElement('span');
      part.textContent = c.text;
      part.title = c.title;
      crumb.append(part);
    });
    bar.append(crumb);
  }

  if (info.cases !== undefined && info.cases.length > 0) {
    bar.append(progressBar(doc, progressOf(info.cases)));
  }

  const spacer = doc.createElement('span');
  spacer.className = 'topbar-spacer';
  bar.append(spacer);

  // **いま誰の番か。**人の番のときだけ光る（DESIGN.md「使い所」）。
  const phase = doc.createElement('span');
  phase.className = 'topbar-phase';
  phase.textContent = t(PHASE_KEYS[info.phase]);
  bar.append(phase);

  /**
   * **止める手。**Esc はどの段でも実行を止める（判定ではない）。打鍵だけにしない。
   * 判定のボタンと同じ道を通す（`installVerdictButtons` が `data-key` を拾う）。
   */
  if (info.phase !== 'setup' && info.phase !== 'finished') {
    const stop = doc.createElement('button');
    stop.type = 'button';
    stop.className = 'key-action topbar-stop';
    stop.dataset['key'] = 'Escape';
    stop.textContent = `${t('topbar.stop')}（${keyCap('Escape')}）`;
    bar.append(stop);
  }

  if (info.operator !== undefined && info.operator !== '') {
    const who = doc.createElement('span');
    who.className = 'topbar-operator';
    who.title = t('topbar.operator');
    who.textContent = info.operator;
    bar.append(who);
  }
}
