/**
 * **同時に 1 本しか走らせない**（外部レビュー meta-taro/git-qa#34）。
 *
 * > 常時 28 個前後が同時に生きていました。1 つ 1 つは短命ですが、
 * > **死ぬより速く生まれています。**
 *
 * 画面を撮る道（`osascript` / `screencapture`）は**外の道具**なので、
 * 頼むたびにプロセスが 1 つ立つ。**返るより速く頼むと、積み上がる。**
 *
 * **遅い機械ほど積み上がる** —— つまり**出る所でだけ出る。**
 * 速い機械で試している側からは、いちばん見つけにくい形。
 */
export function oneAtATime<T>(work: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | undefined;

  return () => {
    // 走っているなら、その 1 本に相乗りする（新しく立てない）。
    if (running !== undefined) return running;

    const started = work().finally(() => {
      // **落ちても外す。**外し忘れると、以後ずっと古い結果を配ることになる。
      running = undefined;
    });
    running = started;
    return started;
  };
}
