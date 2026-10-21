// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { progressOf, renderTopbar, shortPath } from '../src/topbar.js';

let bar: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  bar = document.createElement('header');
  document.body.append(bar);
});

const cases = [
  { no: 1, title: 'a', result: 'VERIFIED' as const, verifiedBy: 'octocat' },
  { no: 2, title: 'b', result: 'AUTO_PASS' as const },
  { no: 3, title: 'c', result: 'BLOCKED' as const, verifiedBy: 'octocat' },
  { no: 4, title: 'd' },
];

describe('上の帯', () => {
  it('シートと相手を出す（長いパスは最後の 2 段）', () => {
    renderTopbar(bar, {
      phase: 'waiting',
      sheetPath: '/repo/sheets/regression.tsv',
      target: 'R5CT1234',
    });
    expect(bar.querySelector('.topbar-crumb')?.textContent).toBe('sheets/regression.tsv/R5CT1234');
  });

  it('知らない値の欄は出さない', () => {
    renderTopbar(bar, { phase: 'running' });
    expect(bar.querySelector('.topbar-crumb')).toBeNull();
    expect(bar.querySelector('.topbar-progress')).toBeNull();
    expect(bar.querySelector('.topbar-operator')).toBeNull();
  });

  it('結果の付いた数 / 全部', () => {
    renderTopbar(bar, { phase: 'waiting', cases });
    expect(bar.querySelector('.topbar-count')?.textContent).toBe('3 / 4');
  });

  it('いま誰の番かを出し、段を印にする', () => {
    renderTopbar(bar, { phase: 'waiting' });
    expect(bar.dataset['phase']).toBe('waiting');
    expect(bar.querySelector('.topbar-phase')?.textContent).toBe('あなたの番');
  });

  it('走っている間は止める手が在る（Esc と同じ道）', () => {
    renderTopbar(bar, { phase: 'running' });
    expect(bar.querySelector<HTMLElement>('.topbar-stop')?.dataset['key']).toBe('Escape');
  });

  it('準備中・終わった後は止める手を出さない', () => {
    renderTopbar(bar, { phase: 'setup' });
    expect(bar.querySelector('.topbar-stop')).toBeNull();
    renderTopbar(bar, { phase: 'finished' });
    expect(bar.querySelector('.topbar-stop')).toBeNull();
  });
});

describe('progressOf', () => {
  it('BLOCKED は止まった側に数える', () => {
    expect(progressOf(cases)).toEqual({
      placed: 3,
      total: 4,
      verified: 1,
      auto: 1,
      failed: 1,
      skipped: 0,
    });
  });
});

describe('shortPath', () => {
  it('Windows の区切りでも最後の 2 段', () => {
    expect(shortPath('C:\\work\\sheets\\a.tsv')).toBe('sheets/a.tsv');
  });
});
