/**
 * **落ちても、人が置いた判定を失わない**（外部レビュー meta-taro/git-qa#2）。
 *
 * > シート実行の途中で host が落ちると、それまでに人が置いた判定が全部消えます。
 *
 * 数えたら、そのとおりだった。
 *
 * ```
 * run-cli: 0 / run-web-cli: 0 / run-desktop-cli: 0 / app-cli: 2
 * ```
 *
 * **人が横に座って判定を置く 3 つが、揃って signal を拾っていなかった。**
 * 証跡は「最後に 1 回」しか書かれないので、`session.done` に着く前に死ぬと**全部消える。**
 *
 * この製品の値打ちは「**人が名前を置いた**」ことの記録なので、
 * **その名前が、走り切ったときだけ残る**のは惜しい。
 *
 * **これで救えるのは「拾える落ち方」だけ。**`SIGKILL`・電源・親ごと消える、は救えない。
 *
 * **そして `vite-node` の下では、そもそも動かない**（2026-09-11 実測。
 * `prependListener` でも、同期でファイルに書いても、1 度も動かなかった）。
 * 手元で `pnpm run:sheet:*` を叩く道はすべて `vite-node` を通るので、そこでは効かない。
 * **効くのは配布版**（`host-bundle.mjs` は node が直接走らせる）。
 *
 * **落ち方を選ばない守りは `saveRunProgress`**（1 件終わるたびに書く）。
 * こちらは「行儀よく止めたときに、最後まで書き切る」ための道。
 */

export interface SaveOnExitOptions {
  /** signal を受ける口。**検査では差し替える。** */
  readonly on: (name: string, handler: () => void) => void;
  /** 証跡を書く。**書けなかったら投げてよい**（理由は呼び側が出す）。 */
  readonly save: () => Promise<void>;
  /** 終わる。既定は `process.exit(0)`。 */
  readonly exit: (code?: number) => void;
}

export function installSaveOnExit(options: SaveOnExitOptions): void {
  let leaving = false;

  const leave = (): void => {
    // **2 度目は動かさない。**書いている最中にもう一度来ると、同じ証跡を 2 回書く。
    if (leaving) return;
    leaving = true;

    void options
      .save()
      // **書けなくても終わる。**書けないことを理由に、端末を掴んだまま居座らない。
      .catch(() => undefined)
      .finally(() => options.exit(0));
  };

  for (const name of ['SIGINT', 'SIGTERM']) options.on(name, leave);
}
