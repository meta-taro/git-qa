// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@git-qa/core/session';

import { createAgentCursor } from '../../src/agent/cursor.js';
import { setLocale } from '../../src/i18n/current.js';
import { MESSAGES, createTranslator } from '../../src/i18n/index.js';
import type { Locale } from '../../src/i18n/index.js';
import { renderColumns } from '../../src/render.js';
import { installVerdictButtons, renderSession } from '../../src/session/view.js';

/**
 * **本物の判定の欄に対して、専用カーソルは判定を押せない**（C1 / C17・C120）。
 *
 * `cursor.test.ts` は自分で作った `.key-action` を使う。ここは画面が実際に描く判定の欄で、
 * 両方の言語の、全部のキーの文字を click / type して、1 つも押せないことを見る。
 */

const state: SessionState = {
  runId: '20260902-150000',
  phase: 'waiting',
  awaiting: 2,
  cases: [
    { no: 1, title: 'アプリが起動する', aiResult: 'PASS', result: 'VERIFIED', verifiedBy: 'qa' },
    { no: 2, title: 'メモを保存できる', aiResult: 'PASS' },
  ],
};

let root: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  renderColumns(root);
});
afterEach(() => {
  setLocale('ja');
});

const keyLabels = (locale: Locale): string[] =>
  (['key.verified', 'key.fail', 'key.blocked', 'key.skip', 'key.advance'] as const).map(
    (key) => MESSAGES[locale][key],
  );

describe.each(['ja', 'en'] as Locale[])('判定の欄の本物のキー（%s）', (locale) => {
  it('どのキーの文字を click / type しても、判定は置かれない。理由が吹き出しに出る', async () => {
    setLocale(locale);
    renderSession(root, state);
    const onKey = vi.fn();
    installVerdictButtons(root, onKey);
    const keys = [...root.querySelectorAll<HTMLElement>('.key-action')];
    expect(keys.length).toBeGreaterThanOrEqual(4);

    const agent = createAgentCursor({
      doc: document,
      win: window,
      t: createTranslator(locale),
      isVisible: () => true,
      wait: () => Promise.resolve(),
    });

    for (const label of keyLabels(locale)) {
      await agent.run({ action: 'click', target: label });
      await agent.run({ action: 'type', target: label, value: 'x' });
      // 文字の一部（「合格」など）で指しても同じ。
      await agent.run({ action: 'click', target: label.slice(0, 4) });
    }

    expect(onKey).not.toHaveBeenCalled();
    expect(document.querySelector('.agent-bubble-text')?.textContent).toBe(
      MESSAGES[locale]['agent.refused.verdict'],
    );
  });
});
