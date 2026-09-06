import { describe, expect, it } from 'vitest';

import { browserCandidates, browserLabel, parseBrowserVersion } from '../src/launch.js';

/**
 * どのブラウザで見たかを、選べて・残せるようにする（人の求め・2026-09-06）。
 *
 * > chrome, エッヂを選択できて、検証時につかったブラウザのバージョンなども記録できるとなおよいです。
 *
 * **証跡としては基本。**同じ画面でも版が違えば結果が変わる。
 * 後から「どのブラウザのどの版で見たか」が読めないと、証跡として弱い。
 */

describe('browserCandidates', () => {
  it('指定が無ければ、入っているものを順に探す', () => {
    const all = browserCandidates();

    expect(all.some((p) => p.includes('Google Chrome'))).toBe(true);
    expect(all.some((p) => p.includes('Microsoft Edge'))).toBe(true);
  });

  it('Chrome を選べる（Edge は候補から外れる）', () => {
    const only = browserCandidates('chrome');

    expect(only.some((p) => p.includes('Google Chrome') || p.includes('chrome.exe'))).toBe(true);
    expect(only.some((p) => p.includes('Edge'))).toBe(false);
  });

  it('Edge を選べる（Chrome は候補から外れる）', () => {
    const only = browserCandidates('edge');

    expect(only.some((p) => p.includes('Edge') || p.includes('msedge.exe'))).toBe(true);
    expect(only.some((p) => p.includes('Google Chrome'))).toBe(false);
  });

  it('Windows の場所も候補に入っている（Windows でも同じコードで動かすため）', () => {
    expect(browserCandidates('edge').some((p) => p.includes('C:\\'))).toBe(true);
  });
});

describe('parseBrowserVersion', () => {
  it('ブラウザが名乗った版を読む', () => {
    expect(parseBrowserVersion({ product: 'Chrome/141.0.7390.55' })).toBe('Chrome/141.0.7390.55');
  });

  it('Edge は userAgent のほうに出るので、そちらを優先する', () => {
    // Edge は product に `Chrome/…` と名乗る。**どちらで見たかが混ざる。**
    expect(
      parseBrowserVersion({
        product: 'Chrome/141.0.7390.55',
        userAgent: 'Mozilla/5.0 … Chrome/141.0.7390.55 Safari/537.36 Edg/141.0.3537.57',
      }),
    ).toBe('Edg/141.0.3537.57');
  });

  it('読めなければ undefined（分からないものを書かない）', () => {
    expect(parseBrowserVersion({})).toBeUndefined();
    expect(parseBrowserVersion({ product: 42 })).toBeUndefined();
  });
});

describe('browserLabel', () => {
  it('選んだ名前と版を並べる（証跡に残る形）', () => {
    expect(browserLabel('/Applications/Google Chrome.app/x', 'Chrome/141.0.7390.55')).toBe(
      'Google Chrome（Chrome/141.0.7390.55）',
    );
  });

  it('版が分からなくても、何で見たかは残す', () => {
    expect(browserLabel('/Applications/Microsoft Edge.app/x', undefined)).toBe('Microsoft Edge');
  });
});
