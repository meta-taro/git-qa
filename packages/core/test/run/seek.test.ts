import { describe, expect, it } from 'vitest';

import type { Action, TargetSession } from '../../src/adapter/types.js';
import { createFakeAdapter } from '../../src/adapter/fake.js';
import type { CaseContext } from '../../src/run/execute.js';
import {
  createSheetCaseRunner,
  EXPECTATION_COLUMN,
  STEPS_COLUMN,
} from '../../src/run/case-runner.js';

/**
 * **見えるまで送る**（C109）。
 *
 * キーを決まった回数押して送る書き方は、画面が長くなると同じ所に来なくなった
 * （PageUp ×3 で出ていた札が、札を 2 つ足したら出なくなった）。
 * **「何が見えたら止まるか」を書けば、画面の長さに左右されない。**
 */

interface Screen {
  /** 送った回数ごとの画面の文字。最後の画面は、それ以上送っても変わらない。 */
  readonly pages: readonly string[];
  readonly kind?: 'android' | 'desktop' | 'web';
  readonly size?: boolean;
}

async function run(steps: string, screen: Screen) {
  const base = await createFakeAdapter({ kind: screen.kind ?? 'android' }).connect();
  const acted: Action[] = [];
  let page = 0;
  const session: TargetSession = {
    ...base,
    target: { ...base.target, kind: screen.kind ?? 'android' },
    get isClosed() {
      return base.isClosed;
    },
    act: (action) => {
      acted.push(action);
      if (action.kind === 'swipe') {
        const from = action.from.at === 'point' ? action.from.y : 0;
        const to = action.to.at === 'point' ? action.to.y : 0;
        page = Math.max(0, Math.min(screen.pages.length - 1, page + (from > to ? 1 : -1)));
      }
      return Promise.resolve();
    },
    ...(screen.size === false
      ? {}
      : { screenSize: () => Promise.resolve({ width: 400, height: 800 }) }),
  };
  const notes: string[] = [];
  const runner = createSheetCaseRunner({
    readScreenText: () => Promise.resolve(`済\n${screen.pages[page] ?? ''}`),
    expectation: { waitMs: 0, stepMs: 1 },
    seek: { pauseMs: 0 },
  });
  const ctx: CaseContext = {
    subject: {
      no: 1,
      title: 'あ',
      row: {
        index: 0,
        line: 2,
        raw: '',
        cells: { [STEPS_COLUMN]: steps, [EXPECTATION_COLUMN]: '「済」と表示される' },
        rawCells: {},
      },
    },
    session,
    step: () => undefined,
    note: (detail) => notes.push(detail),
  };
  const verdict = await runner(ctx);
  return { verdict, acted, notes, swipes: acted.filter((a) => a.kind === 'swipe') };
}

describe('見えるまで送る', () => {
  it('見えるまで送り、見えたら止まる', async () => {
    const { swipes, notes } = await run('1. 「札」が見えるまで送る', {
      pages: ['上', '中', '札'],
    });

    expect(swipes).toHaveLength(2);
    expect(notes.join('\n')).toMatch(/2 回送って「札」が見えた/);
  });

  it('はじめから見えていれば、送らない', async () => {
    const { swipes, notes } = await run('1. 「札」が見えるまで送る', { pages: ['札'] });

    expect(swipes).toHaveLength(0);
    expect(notes.join('\n')).toMatch(/送る前から「札」が見えていた/);
  });

  it('送っても画面の文字が変わらなければ止まる（BLOCKED）', async () => {
    const { verdict, swipes } = await run('1. 「無い札」が見えるまで送る', {
      pages: ['上', '下'],
    });

    expect(verdict.aiResult).toBe('BLOCKED');
    expect(verdict.note).toMatch(/送っても画面の文字が変わらなくなった.*「無い札」は見えなかった/);
    // **最後に見えていた文字を添える。**画面を開かずに、端に着いたのか送れていないのかを読めるように。
    expect(verdict.note).toMatch(/最後に見えていたのは「下」/);
    expect(swipes).toHaveLength(2);
  });

  it('上へ送るときは、なぞる向きが逆になる', async () => {
    const { swipes } = await run('1. 「札」が見えるまで上へ送る', { pages: ['上', '札'] });

    const [first] = swipes;
    expect(
      first?.kind === 'swipe' && first.from.at === 'point' && first.to.at === 'point'
        ? first.from.y < first.to.y
        : false,
    ).toBe(true);
  });

  it('デスクトップは少しずつ送る（1 回で画面より遠くへ飛ばさない）', async () => {
    const { swipes } = await run('1. 「札」が見えるまで送る', {
      pages: ['上', '札'],
      kind: 'desktop',
    });

    const [first] = swipes;
    const moved =
      first?.kind === 'swipe' && first.from.at === 'point' && first.to.at === 'point'
        ? first.from.y - first.to.y
        : 0;
    expect(moved).toBe(30);
  });

  it('画面の大きさが分からない相手では、送らずに人へ回す', async () => {
    const { verdict, swipes } = await run('1. 「札」が見えるまで送る', {
      pages: ['上', '札'],
      size: false,
    });

    expect(verdict.aiResult).toBe('BLOCKED');
    expect(verdict.note).toMatch(/画面の大きさが分からない/);
    expect(swipes).toHaveLength(0);
  });
});
