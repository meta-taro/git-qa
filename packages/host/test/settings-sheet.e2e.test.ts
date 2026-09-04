import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseTestSpecTsv, createSheetCaseRunner, toCaseSubjects } from '@git-qa/core';
import { createAndroidAdapter, readAndroidScreenText } from '@git-qa/adapter-android';

/**
 * 配っているシート（`sheets/android-settings.tsv`）が、**実物の端末で最後まで通ること**。
 *
 * 2026-09-02 の実行記録は 5 件とも BLOCKED だった。原因は端末側ではなく、
 * **こちらが用意したシートが架空のアプリを指していたこと**。同じことを繰り返さないために、
 * 「配っているシートが実機で通る」をここで固定する。
 *
 * 既定では走らない（product-baseline §4）。端末を繋いだうえで:
 *   GIT_QA_ANDROID_E2E=1 pnpm test:run
 *
 * 画面の文字は端末の言語設定で変わる。**英語表示の端末が前提**（シートにもそう書いてある）。
 */
const enabled = process.env['GIT_QA_ANDROID_E2E'] === '1';
const serial = process.env['GIT_QA_ANDROID_SERIAL'];

const SHEET_PATH = fileURLToPath(new URL('../../../sheets/android-settings.tsv', import.meta.url));

describe.skipIf(!enabled)('配っているシートが実機で通る', () => {
  it('5 件すべて、AI だけで PASS まで行く', { timeout: 180_000 }, async () => {
    const sheet = parseTestSpecTsv(await readFile(SHEET_PATH, 'utf8'));
    const adapter = createAndroidAdapter({
      build: { source: 'android/settings', label: 'e2e' },
      ...(serial === undefined ? {} : { serial }),
    });
    const session = await adapter.connect();
    const run = createSheetCaseRunner({
      readScreenText: readAndroidScreenText,
      ...(sheet.meta['対象'] === undefined ? {} : { app: sheet.meta['対象'] }),
    });

    try {
      const results: string[] = [];
      const notes: string[] = [];
      for (const subject of toCaseSubjects(sheet)) {
        const verdict = await run({ subject, session, step: () => undefined });
        results.push(`${String(subject.no)} ${verdict.aiResult}`);
        if (verdict.aiResult !== 'PASS') notes.push(`${String(subject.no)}: ${verdict.note ?? ''}`);
      }
      expect({ results, notes }).toEqual({
        results: ['1 PASS', '2 PASS', '3 PASS', '4 PASS', '5 PASS'],
        notes: [],
      });
    } finally {
      await session.close();
    }
  });
});
