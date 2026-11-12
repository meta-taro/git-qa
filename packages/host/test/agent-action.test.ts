import { describe, expect, it } from 'vitest';

import { AgentActionError, parseAgentAction } from '../src/agent-action.js';

/**
 * エージェントの専用カーソルへの指示（C120）。
 *
 * **画面へ流す前に形を検査する。**おかしければ理由つきで断る。黙って捨てると、
 * 呼んだ側は「届いたのに動かない」と受け取る。
 */

const bad = (body: unknown): string => {
  try {
    parseAgentAction(body);
  } catch (error: unknown) {
    if (error instanceof AgentActionError) return error.message;
    throw error;
  }
  throw new Error('断らなかった');
};

describe('parseAgentAction', () => {
  it('point / click は、指す言葉（target）が要る', () => {
    expect(parseAgentAction({ action: 'point', target: '始める' })).toEqual({
      action: 'point',
      target: '始める',
    });
    expect(parseAgentAction({ action: 'click', target: '始める', message: 'ここです' })).toEqual({
      action: 'click',
      target: '始める',
      message: 'ここです',
    });
    expect(bad({ action: 'point' })).toContain('target');
    expect(bad({ action: 'click', target: '   ' })).toContain('target');
  });

  it('type は、欄（target）と打つ文字（value）が要る', () => {
    expect(parseAgentAction({ action: 'type', target: 'URL', value: 'http://a' })).toEqual({
      action: 'type',
      target: 'URL',
      value: 'http://a',
    });
    expect(bad({ action: 'type', target: 'URL' })).toContain('value');
  });

  it('go は、画面の中の場所（# で始まる）だけ。外のページへは移らせない', () => {
    expect(parseAgentAction({ action: 'go', hash: '#cases' })).toEqual({
      action: 'go',
      hash: '#cases',
    });
    expect(bad({ action: 'go', hash: 'https://example.com' })).toContain('#');
  });

  it('say は一言（message）が要り、seconds は 1〜60', () => {
    expect(parseAgentAction({ action: 'say', message: 'こんにちは', seconds: 3 })).toEqual({
      action: 'say',
      message: 'こんにちは',
      seconds: 3,
    });
    expect(bad({ action: 'say' })).toContain('message');
    expect(bad({ action: 'say', message: 'a', seconds: 0 })).toContain('seconds');
    expect(bad({ action: 'say', message: 'a', seconds: 61 })).toContain('seconds');
    expect(bad({ action: 'say', message: 'a', seconds: 'long' })).toContain('seconds');
  });

  it('長すぎる文は断る（画面に出す文は 500 文字まで）', () => {
    expect(bad({ action: 'say', message: 'あ'.repeat(501) })).toContain('500');
    expect(bad({ action: 'type', target: 'URL', value: 'a'.repeat(501) })).toContain('500');
  });

  it('知らない action と、物でない指示は、理由を言って断る', () => {
    expect(bad({ action: 'drag', target: 'x' })).toContain('drag');
    expect(bad('point')).toContain('JSON');
    expect(bad(null)).toContain('JSON');
    expect(bad([])).toContain('JSON');
  });

  /**
   * **filter は git-qa には無い。**人で絞る欄が画面に無いので、受けても何も起きない。
   * 「届けた」と返して何も起きないより、無いと言う。
   */
  it('filter は、この画面に人で絞る欄が無いので断る', () => {
    expect(bad({ action: 'filter', value: 'qa' })).toContain('人で絞る欄');
  });

  it('余計な欄は捨てる（画面へは検査した形だけを流す）', () => {
    expect(parseAgentAction({ action: 'point', target: 'x', extra: 1, __proto__: {} })).toEqual({
      action: 'point',
      target: 'x',
    });
  });
});
