import { readFile } from 'node:fs/promises';

import { formatMs, measureRun, renderBench } from '@git-qa/core';
import type { BenchRun } from '@git-qa/core';

import { fromInvocationDir } from './paths.js';

/**
 * 証跡から、所要時間と手数を出す（Issue 008・C48・C117）。
 *
 *   pnpm bench:run runs/<日時>/run.json [runs/<日時>/run.json ...] [--manual <分>]
 *
 * 複数渡せば 1 本ずつ出し、最後に合計を出す（20 ケースを何回かに分けて流したとき）。
 * `--manual` は、同じケース群を人が手で通した所要時間（分）。渡すと C48 の線で判定する。
 *
 * **ここは配線なので検査していない。**判断のある所（数え方と、出す文）は
 * `@git-qa/core` の `bench.ts` にあり、そちらは検査してある。
 */

const USAGE = '使い方: pnpm bench:run <runs/日時/run.json> [...] [--manual <分>]';

const args = process.argv.slice(2);
const paths: string[] = [];
let manualMs: number | undefined;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--manual') {
    const minutes = Number(args[i + 1]);
    if (!(minutes > 0)) {
      console.error(`[git-qa] --manual には 0 より大きい分を渡す。${USAGE}`);
      process.exit(2);
    }
    manualMs = minutes * 60_000;
    i += 1;
    continue;
  }
  if (arg !== undefined) paths.push(arg);
}

if (paths.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

const benches = [];
for (const given of paths) {
  const resolved = fromInvocationDir(given);
  let run: BenchRun;
  try {
    run = JSON.parse(await readFile(resolved, 'utf8')) as BenchRun;
  } catch {
    // 積み上がったスタックではなく、人が次に何をすればよいかが分かる形で出す。
    console.error(`[git-qa] 証跡を読めない: ${resolved}`);
    process.exit(1);
  }
  const bench = measureRun(run);
  benches.push(bench);
  // 1 本だけなら、手作業との比はその 1 本に対して出す。
  console.log(
    renderBench(bench, benches.length === 1 && paths.length === 1 ? manualMs : undefined),
  );
  console.log('');
}

if (benches.length > 1) {
  const measured = benches.filter((b) => b.totalMs !== undefined);
  const totalMs = measured.reduce((sum, b) => sum + (b.totalMs ?? 0), 0);
  const cases = benches.reduce((sum, b) => sum + b.cases, 0);
  const placed = benches.reduce((sum, b) => sum + b.placed, 0);
  console.log(
    `合計 ${String(benches.length)} 本: ${String(cases)} 件（人が置いた ${String(placed)} 件）`,
  );
  if (measured.length !== benches.length) {
    console.log(
      `  所要を出せない証跡が ${String(benches.length - measured.length)} 本ある。合計はそれを除いた値`,
    );
  }
  console.log(`  所要: ${formatMs(totalMs)}`);
  if (manualMs !== undefined && measured.length > 0) {
    // 合計に対して C48 の線を当てる。文は 1 本のときと同じにする。
    const merged = {
      ...measured[0]!,
      runId: '合計',
      cases,
      placed,
      totalMs,
    };
    const text = renderBench(merged, manualMs);
    const tail = text
      .split('\n')
      .filter(
        (line) =>
          line.startsWith('ケースが 20') || line.startsWith('手作業:') || line.startsWith('  注記'),
      );
    console.log(tail.join('\n'));
  }
}
