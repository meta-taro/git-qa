// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionState } from '@git-qa/core/session';

import { renderColumns } from '../../src/render.js';
import { renderCaseStrip } from '../../src/session/strip.js';

const state: SessionState = {
  runId: 'r',
  phase: 'waiting',
  awaiting: 3,
  cases: [
    { no: 1, title: 'アプリが起動する', result: 'AUTO_PASS' },
    { no: 3, title: '開き直すと戻る' },
  ],
};

let root: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  renderColumns(root);
});

const strips = (): NodeListOf<Element> =>
  root.querySelectorAll('[data-column-id="live"] .case-strip');

describe('映像の上の 1 行', () => {
  it('打鍵待ちのケースの番号と題名が出る', () => {
    renderCaseStrip(root, state, undefined);
    expect(strips()[0]?.textContent).toBe('#03開き直すと戻る');
  });

  it('戻って見ているときは、見ているケースが出る', () => {
    renderCaseStrip(root, state, 1);
    expect(strips()[0]?.textContent).toContain('アプリが起動する');
  });

  it('描き直しても増えない・映像の器には触らない', () => {
    const live = root.querySelector('[data-column-id="live"]')!;
    const stage = root.ownerDocument.createElement('div');
    stage.className = 'live-stage';
    live.append(stage);

    renderCaseStrip(root, state, undefined);
    renderCaseStrip(root, state, undefined);

    expect(strips()).toHaveLength(1);
    expect(live.querySelector('.live-stage')).toBe(stage);
  });

  it('待っているケースが無ければ、いまの段を言う', () => {
    const { awaiting: _a, ...rest } = state;
    renderCaseStrip(root, { ...rest, phase: 'running' }, undefined);
    expect(strips()[0]?.textContent).toContain('AI が操作');
  });
});
