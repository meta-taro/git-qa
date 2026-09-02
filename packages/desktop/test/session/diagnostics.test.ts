import { describe, expect, it, vi } from 'vitest';

import { reportDiagnostics } from '../../src/session/diagnostics.js';

/**
 * 画面の中の様子を外へ出す。
 *
 * **「映っていますか」と人に聞かないと分からない状態を減らす**のが目的。
 */

describe('reportDiagnostics', () => {
  it('いまの様子を診断の口へ送る', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    await reportDiagnostics(
      'http://127.0.0.1:1/live/a/control',
      { decoded: 30, drawn: 29, canvas: { width: 1080, height: 2220 } },
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:1/live/a/control/diag', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decoded: 30, drawn: 29, canvas: { width: 1080, height: 2220 } }),
    });
  });

  it('送れなくても落とさない（診断のために本筋を止めない）', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('繋がらない'));

    await expect(
      reportDiagnostics('http://127.0.0.1:1/live/a/control', { decoded: 0, drawn: 0 }, fetchImpl),
    ).resolves.toBeUndefined();
  });
});
