import { describe, expect, it } from 'vitest';

import { mcpTargetFrom, targetHint } from '../src/target.js';

/**
 * **エージェントが操作できる相手を、Android だけにしない**（人の指示・2026-09-17）。
 *
 * > 全自動でテスト動画をとる場合、エージェントの操作は必須となります。
 *
 * MCP の道具は既に**アダプタ非依存**（`connect` を受け取るだけ）だった。
 * **相手を選ぶ配線だけが Android 固定**で、ウェブもデスクトップも触れなかった
 * （README の表は 3 つとも触れるように読めていた・外部レビュー #23）。
 */
describe('mcpTargetFrom', () => {
  it('既定は Android（今までどおり）', () => {
    expect(mcpTargetFrom({})).toMatchObject({ kind: 'android' });
  });

  it('ウェブを選べる', () => {
    const target = mcpTargetFrom({ GIT_QA_MCP_TARGET: 'web', GIT_QA_MCP_URL: 'http://a/' });

    expect(target).toMatchObject({ kind: 'web', url: 'http://a/' });
  });

  /** **既に起きているブラウザにも繋げる**（#30）。Playwright が前準備を済ませた先。 */
  it('繋ぎ先を渡せる', () => {
    const target = mcpTargetFrom({
      GIT_QA_MCP_TARGET: 'web',
      GIT_QA_MCP_URL: 'http://a/',
      GIT_QA_CDP: 'http://127.0.0.1:9222',
    });

    expect(target).toMatchObject({ kind: 'web', attachTo: 'http://127.0.0.1:9222' });
  });

  it('デスクトップを選べる', () => {
    const target = mcpTargetFrom({ GIT_QA_MCP_TARGET: 'desktop', GIT_QA_MCP_APP: 'メモ' });

    expect(target).toMatchObject({ kind: 'desktop', app: 'メモ' });
  });

  /** **行き先が無いまま繋がない。**当て推量で別の場所を見に行かせない（C40）。 */
  it('ウェブなのに行き先が無ければ、断る', () => {
    expect(() => mcpTargetFrom({ GIT_QA_MCP_TARGET: 'web' })).toThrow(/GIT_QA_MCP_URL/);
  });

  it('デスクトップなのにアプリ名が無ければ、断る', () => {
    expect(() => mcpTargetFrom({ GIT_QA_MCP_TARGET: 'desktop' })).toThrow(/GIT_QA_MCP_APP/);
  });

  /**
   * **iPhone / iPad も受け取る**（2026-09-19・C75）。
   *
   * **押す口は無い。**だから AI にできるのは**見る・読む**だけ ——
   * それでも受け取る口が無いと、**AI は画面を 1 文字も読めない。**
   */
  it('iPhone / iPad を受け取る', () => {
    expect(mcpTargetFrom({ GIT_QA_MCP_TARGET: 'ios' })).toEqual({ kind: 'ios' });
  });

  it('端末を指すこともできる', () => {
    expect(mcpTargetFrom({ GIT_QA_MCP_TARGET: 'ios', GIT_QA_MCP_IOS_DEVICE: '0001' })).toEqual({
      kind: 'ios',
      device: '0001',
    });
  });

  /** **知らない相手は受け取らない。**当てにいくと、別のものを触る。 */
  it('知らない相手は断る', () => {
    expect(() => mcpTargetFrom({ GIT_QA_MCP_TARGET: 'ipados' })).toThrow(/ipados/);
  });
});

describe('targetHint', () => {
  /** **押せないことを、最初に言う。**操作できるつもりで回させない。 */
  it('iPhone / iPad では、押せないことまで言う', () => {
    const said = targetHint({ kind: 'ios' });

    expect(said).toContain('iPhone');
    expect(said).toMatch(/押す口はありません/);
  });

  /** **いま何を触っているかを、AI へ最初に言う。**取り違えたまま操作させない。 */
  it('いまの相手を言う', () => {
    expect(targetHint({ kind: 'web', url: 'http://a/' })).toContain('http://a/');
    expect(targetHint({ kind: 'android' })).toContain('Android');
  });
});
