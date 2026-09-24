/**
 * 偽の画面。**押す前は空、押したあとに文字が出る**（2026-09-24）。
 *
 * **前は押す前も後も同じ文字を返していた。**それだと
 * 「**押す前から在る文字は、確かめたことにならない**」という守り（`wasAlreadyThere`）に
 * 引っかかる —— **引っかかるのが正しい。**実物の画面は、押して初めて変わる。
 *
 * ケースごとに数え直す必要は無い。**1 件ごとに 1 回目が「押す前」**になるので、
 * ここでは**ケースをまたいで「1 回目だけ空」**にはしない ——
 * **各ケースの 1 回目を空にする**（`perCase`）。
 */
export function fakeScreen(text: string): () => Promise<string> {
  let asked = 0;
  return () => {
    asked += 1;
    return Promise.resolve(asked === 1 ? '' : text);
  };
}

/**
 * **ケースごとに「押す前」を空にする。**
 *
 * 1 件の中で `readScreenText` は「押す前に 1 回 → 出るまで何回か」呼ばれる。
 * **出た時点で抜ける**ので、通るケースは 2 回で終わる。そこを数えて区切る。
 */
export function fakeScreenPerCase(text: string, readsPerCase = 2): () => Promise<string> {
  let asked = 0;
  return () => {
    const at = asked % readsPerCase;
    asked += 1;
    return Promise.resolve(at === 0 ? '' : text);
  };
}
