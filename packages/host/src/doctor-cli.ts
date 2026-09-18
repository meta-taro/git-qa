/**
 * **この機械で何ができるかを出す**（`pnpm doctor`）。
 *
 * **各々の OS で開発するために要る口**（2026-09-19・人の指示）。
 * 「自分の機械では動いた」をそのまま渡せるようにする ——
 * 何が在って何が無いかを**同じ形で**言えないと、「動かない」の原因が
 * **機械の差なのか、こちらの不具合なのか**が分からない。
 *
 * **そのまま Issue へ貼れる形**で出す。
 */
import { reportOf, verdictOf } from './doctor.js';
import { PROBES } from './doctor-probes.js';
import { runnerOf } from './release.js';

const said = await reportOf(PROBES, {
  platform: `${process.platform} ${process.arch}`,
  release: runnerOf().version,
});
console.log(said);

// **欠けていても 0 で返す。**これは診断であって、品質ゲートではない
// （CI で落とすためのものにすると、人が測るのをやめる）。
const all = await Promise.all(PROBES.map((p) => p.run().catch(() => undefined)));
const verdict = verdictOf(all.filter((r) => r !== undefined));
if (verdict !== 'ok') {
  console.log('');
  console.log('[git-qa] 欠けているものがあります（それでも動く所は動きます）');
}
